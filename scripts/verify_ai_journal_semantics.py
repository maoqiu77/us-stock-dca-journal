"""Explicit, bounded paired answer review on public held-out originals only."""
from __future__ import annotations

import argparse
import copy
from datetime import datetime
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import time
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps/api'))
DATASET = ROOT / 'storage/templates/ai-journal-agent-phase7-heldout.json'
MAX_REVIEW_REQUESTS = 300
PAIR_REQUEST_RESERVATION = 5


def content_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def normalized_usage(usage):
    if not isinstance(usage, dict):
        raise ValueError('reported_usage_required')
    values = [usage.get('input_tokens', usage.get('prompt_tokens')),
        usage.get('output_tokens', usage.get('completion_tokens'))]
    if any(type(value) is not int or value < 0 for value in values):
        raise ValueError('reported_usage_required')
    return {'input_tokens': values[0], 'output_tokens': values[1]}


def verify(dataset, *, real=False, request_limit=110):
    from app.core import database, settings as core
    from app.modules import ai_settings
    from app.modules.ai_journal.agent.evaluation import evaluate_retrieval
    from app.modules.ai_journal.agent.deepseek import wire_messages
    from app.modules.ai_journal.agent.manager import JournalAgentManager
    from app.modules.ai_journal.agent.model import build_agent_model, output_limit_for, ready
    from app.modules.ai_journal.agent.store import AgentStore
    from app.modules.ai_journal.models import ConfirmRequest, PreviewRequest
    from app.modules.ai_journal.service import JournalService, LEGACY_MAX_OUTPUT_TOKENS, model_fingerprint
    from app.modules.ai_journal.prompts import SYSTEM
    from app.modules.ai_journal.agent.prompts import AGENT_SYSTEM
    from app.modules.ai_journal.store import JournalStore
    from app.modules.market_board.store import BoardStore
    from app.modules.privacy_policy import ensure_ai_inference_allowed
    from app.modules.trading_data import save_trading_state

    if not evaluate_retrieval(dataset)['passed'] or not 1 <= request_limit <= MAX_REVIEW_REQUESTS:
        raise ValueError('invalid_synthetic_review_plan')
    config = ai_settings.load_ai_settings()
    ensure_ai_inference_allowed()
    if (config['provider'], config['protocol'], config['complexModel'], config['baseUrl']) != (
        'deepseek', 'chat/completions', 'deepseek-flash', 'https://api.deepseek.com/v1'):
        raise ValueError('reviewed_configuration_required')
    fingerprint = model_fingerprint(config)
    capability = AgentStore(JournalStore()).capability(fingerprint)
    if not ready(config, capability):
        raise ValueError('matching_verified_capability_required_no_probe')
    original_paths = database.DB_PATH, core.DB_PATH, core.DATA_HOME
    home = Path(tempfile.mkdtemp(prefix='semantic-review-', dir=ROOT / 'storage/local')).resolve()
    receipt = {'synthetic_only': True, 'workspace': str(home), 'requests_reserved': 0,
        'request_limit': request_limit, 'closed': False, 'calls': [], 'cases': [],
        'status': 'preparing', 'real_model_tested': False, 'semantic_review': 'pending',
        'dataset_split': dataset.get('split'),
        'dataset_sha256': content_hash(dataset),
        'planned_cases': len(dataset['cases']),
        'evaluation_plan': dataset.get('evaluation_plan', {}),
        'prompt_hashes': {name: hashlib.sha256(prompt.encode()).hexdigest()
            for name, prompt in (('agent', AGENT_SYSTEM), ('legacy_llm', SYSTEM))},
        'prompt_sha256': hashlib.sha256(SYSTEM.encode()).hexdigest(),
        'agent_output_limit': output_limit_for(config), 'legacy_output_limit': LEGACY_MAX_OUTPUT_TOKENS,
        'legacy_reasoning_effort': 'low', 'agent_reasoning_effort': 'provider_default'}

    def persist():
        (home / 'verification.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2))

    def reserve(engine, body):
        with sqlite3.connect(f'file:{original_paths[0]}?mode=ro', uri=True) as db:
            row = db.execute('select payload from app_state where key=?', ('ai_settings_v1',)).fetchone()
        current = ai_settings.sanitize_ai_settings(json.loads(row[0]) if row else {})
        if model_fingerprint(current) != fingerprint:
            receipt.update(closed=True, status='configuration_changed_no_replay')
            persist()
            raise ValueError('configuration_changed')
        size = len(json.dumps(body, ensure_ascii=False).encode())
        if receipt['closed'] or receipt['requests_reserved'] >= request_limit or size > 40000:
            raise ValueError('test_admission_closed')
        entry = {'engine': engine, 'input_bytes': size, 'outcome': 'unknown', 'usage': None}
        receipt['requests_reserved'] += 1
        receipt['calls'].append(entry)
        receipt['real_model_tested'] = True
        persist()
        return entry

    def factory(settings, cap):
        underlying = build_agent_model(settings, cap)
        async def call(messages, tools):
            body = {'messages': wire_messages(messages), 'tools': tools,
                'model': settings['complexModel'], 'max_tokens': output_limit_for(settings)}
            entry = reserve('agent', body)
            try:
                reply = await underlying(messages, tools)
                entry.update(outcome='received', usage=reply.usage_metadata,
                    returned_model=reply.response_metadata.get('model_name'),
                    finish_reason=reply.response_metadata.get('finish_reason'))
                try:
                    normalized_usage(entry['usage'])
                except ValueError:
                    from app.modules.ai_journal.agent.runtime import ModelOutcomeUnknown
                    receipt.update(closed=True, status='stopped_missing_usage_no_replay')
                    raise ModelOutcomeUnknown() from None
                return reply
            except BaseException:
                receipt.update(closed=True, status='stopped_no_replay')
                raise
            finally:
                persist()
        return call

    original_post = ai_settings.requests.post
    def post(url, **kwargs):
        if url != 'https://api.deepseek.com/v1/chat/completions':
            raise ValueError('unreviewed_endpoint')
        body = kwargs['json']
        if (body.get('model') != config['complexModel'] or body.get('max_tokens') != LEGACY_MAX_OUTPUT_TOKENS
            or body.get('reasoning_effort') != 'low'):
            raise ValueError('unreviewed_legacy_configuration')
        entry = reserve('legacy_llm', body)
        try:
            response = original_post(url, **kwargs)
            response.raise_for_status()
            payload = response.json()
            entry.update(outcome='received', usage=payload.get('usage'), returned_model=payload.get('model'),
                finish_reason=(payload.get('choices') or [{}])[0].get('finish_reason'))
            normalized_usage(entry['usage'])
            return response
        except BaseException:
            receipt.update(closed=True, status='stopped_no_replay')
            raise
        finally:
            persist()

    manager = None
    try:
        database.DB_PATH = core.DB_PATH = home / 'synthetic.db'
        core.DATA_HOME = home
        database.init_db()
        trades = [{'id': row['id'], 'ticker': row['ticker'], 'date': row['trade_date'], 'note': row['text'],
            'action': '买入', 'shares': 0, 'unitPrice': 0, 'amount': 0}
            for row in dataset['originals'] if row['kind'] == 'trade_reason']
        save_trading_state({'privacyMode': 'normal', 'account': {'baseCurrency': 'USD'},
            'stockPool': [], 'positions': [], 'trades': trades})
        journal = JournalStore()
        with journal.connect() as db:
            for row in dataset['originals']:
                if row['kind'] == 'note':
                    db.execute('insert into ai_journal_notes values (?,?,?,?,?)',
                        (row['id'], row['text'], row['version_at'], row['version_at'], row.get('deleted_at')))
        store = AgentStore(journal)
        store.save_capability(capability.model_dump())
        board = SimpleNamespace(store=BoardStore(core.DB_PATH), catalog=SimpleNamespace(resolve=lambda _: None))
        service = JournalService(journal, board, settings=lambda: config,
            clock=lambda: datetime.fromisoformat(dataset['known_at']))
        manager = JournalAgentManager(journal, settings=lambda: config, model_factory=factory)
        for index, case in enumerate(dataset['cases']):
            if real and request_limit - receipt['requests_reserved'] < PAIR_REQUEST_RESERVATION:
                receipt.update(closed=True, status='stopped_before_pair_budget')
                persist()
                return receipt
            question = case['question']
            if case.get('after'):
                question += '；仅检索 ' + case['after'] + ' 之后的原文版本。'
            preview = service.preview(PreviewRequest(task_type='conversation', engine='agent', auto_context=True,
                question=question, memory_excluded_ids=case.get('excluded_ids', []), memory_before=case.get('before')))
            originals = preview['private_context'].get('notes', []) + preview['private_context'].get('trade_reasons', [])
            ids = {row['id'] for row in originals}
            if not set(case['expected_original_ids']).issubset(ids) or ids & set(case.get('forbidden_original_ids', [])):
                raise ValueError('frozen_input_scope_invalid')
            result = {'id': case['id'], 'question': question, 'fixed_input': preview,
                'category': case.get('category', 'legacy_corpus'),
                'required_claims': case.get('required_claims', []),
                'expected_original_ids': case['expected_original_ids'],
                'forbidden_original_ids': case.get('forbidden_original_ids', []),
                'fixed_input_sha256': content_hash({key: preview[key] for key in (
                    'private_context', 'facts', 'missing', 'agent_sources')}),
                'engine_order': ['agent', 'legacy_llm'] if index % 2 == 0 else ['legacy_llm', 'agent'],
                'acceptable_response': case['acceptable_response'], 'forbidden_claims': case['forbidden_claims'],
                'engines': {}, 'claim_reviews': [], 'semantic_pass': None}
            receipt['cases'].append(result)
            persist()
            if not real:
                continue
            for engine in result['engine_order']:
                snapshot = preview
                if engine == 'legacy_llm':
                    baseline = copy.deepcopy(preview)
                    for key in ('id', 'digest'):
                        baseline.pop(key)
                    baseline['request']['engine'] = 'llm'
                    snapshot = journal.save_snapshot(baseline, fingerprint)
                    if any(snapshot[key] != preview[key] for key in ('private_context', 'facts', 'missing', 'agent_sources')):
                        raise ValueError('paired_input_mismatch')
                request = ConfirmRequest(snapshot_id=snapshot['id'], digest=snapshot['digest'], idempotency_key='synthetic-' + snapshot['id'])
                before = receipt['requests_reserved']
                started = time.monotonic()
                with patch.object(ai_settings.requests, 'post', post):
                    session = service.confirm(request)
                if engine == 'agent':
                    manager.execute(session['turns'][0]['run_id'])
                    session = journal.session(session['id'])
                turn = session['turns'][0]
                result['engines'][engine] = {'status': turn['status'], 'error_code': turn['error_code'],
                    'answer': turn['answer'], 'run': turn.get('run'),
                    'sources': store.sources(turn['run_id']) if turn.get('run_id') else preview['agent_sources'],
                    'requests': receipt['requests_reserved'] - before,
                    'duration_ms': int((time.monotonic() - started) * 1000), 'semantic_pass': None}
                result['engines'][engine]['calls'] = copy.deepcopy(receipt['calls'][before:])
                result['engines'][engine]['fixed_input_sha256'] = content_hash({key: snapshot[key] for key in (
                    'private_context', 'facts', 'missing', 'agent_sources')})
                unknown_usage = any(row['usage'] is None for row in receipt['calls'][before:])
                if turn['status'] != 'completed' or receipt['closed'] or unknown_usage:
                    receipt.update(closed=True, status='stopped_no_replay')
                    persist()
                    return receipt
                persist()
            print(json.dumps({'case': case['id'], 'status': 'answers_ready_for_review',
                'requests_reserved': receipt['requests_reserved']}), flush=True)
        receipt.update(closed=True, status='answers_ready_for_review' if real else 'prepared_no_requests')
        persist()
        return receipt
    except BaseException:
        receipt.update(closed=True, status='stopped_no_replay')
        persist()
        raise
    finally:
        if manager:
            manager.stop()
        database.DB_PATH, core.DB_PATH, core.DATA_HOME = original_paths


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--prepare-only', action='store_true')
    mode.add_argument('--real', action='store_true')
    parser.add_argument('--request-limit', type=int, default=110)
    parser.add_argument('--dataset', type=Path, default=DATASET)
    args = parser.parse_args()
    receipt = verify(json.loads(args.dataset.read_text()), real=args.real, request_limit=args.request_limit)
    print(json.dumps({key: receipt[key] for key in ('workspace', 'status', 'requests_reserved', 'semantic_review')}))
    return 0 if receipt['status'] in {'answers_ready_for_review', 'prepared_no_requests'} else 1


if __name__ == '__main__':
    raise SystemExit(main())
