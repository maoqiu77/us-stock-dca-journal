"""Explicit real-provider verification using an isolated synthetic workspace only."""
from __future__ import annotations

import argparse
import asyncio
import copy
import json
import os
import sqlite3
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
CLOSEOUT_FILE = ROOT / 'storage/templates/ai-journal-agent-closeout.json'
PHASE7_PAIR_FILE = ROOT / 'storage/templates/ai-journal-agent-phase7-paired.json'
RELEASE_PAIR_FILE = ROOT / 'storage/templates/ai-journal-agent-release-paired-v2.json'
KEY = 'US:XNAS:NVDA:STOCK'
QUESTION = ('合成联调：核对 NVDA 当前持仓和投资计划，检索英伟达的原始买入理由，'
    '用工具计算持仓市值、成本和币种内权重，并读取日线和计算 MA5/20/60。'
    '现金未知时保持未知。用本轮实际来源给出结构化报告。所有数据都是合成测试资料。')
SEMANTIC_QUESTION = ('我当初为什么买入 NVDA？请找回原始交易理由和相关手记，分别说明交易日期、'
    '手记版本时间，以及交易理由的版本时间能否确定。')
FOLLOWUP_QUESTION = ('继续核对 NVDA 当前持仓和投资计划，用工具计算持仓市值、成本、币种内权重，'
    '读取日线并计算 MA5/20/60。原来的持有条件现在是否已得到证实？现金和缺失指标保持未知。')
PORTFOLIO_QUESTION = ('请核对本轮 NVDA 持仓和投资计划及原始买入理由，计算持仓市值、持仓总成本、'
    '币种内持仓权重和已收盘日线的 MA5/20/60。说明现金、账户总仓位及缺失指标能否确定，'
    '原来的需求与盈利持续条件现在是否有证据证实。标明依据和观察时间；只使用本轮合成资料。')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--real', action='store_true', help='Explicitly permit real requests within the reviewed request limit.')
    parser.add_argument('--prepare-only', action='store_true', help='Check isolated fixtures without model requests.')
    parser.add_argument('--semantic-retest', action='store_true', help='New isolated two-turn semantic test and one legacy comparison; no probe.')
    parser.add_argument('--portfolio-comparison', action='store_true', help='New isolated single portfolio turn and matched legacy comparison; at most 5 calls, no probe.')
    parser.add_argument('--closeout-comparison', action='store_true', help='New MSFT fractional/60-bar paired case; 5 requests, legacy normal 120-second timeout, no probe or server.')
    parser.add_argument('--phase7-paired', action='store_true', help='New Phase 7 AAPL fractional/40-bar paired case; 5 requests, no probe or server.')
    parser.add_argument('--release-paired', action='store_true', help='Fresh MSFT paired case using each production engine output budget; 5 requests, no probe or server.')
    parser.add_argument('--serve', action='store_true', help='Serve the synthetic journal workspace after verification.')
    parser.add_argument('--serve-existing', type=Path, help='Serve a verified workspace without replaying its test.')
    parser.add_argument('--ui-case-existing', type=Path, help='Explicit new UI cases in a reviewed successful semantic workspace; preserve its shared budget.')
    parser.add_argument('--read-only-existing', type=Path, help='Serve reviewed comparison archives with every POST disabled; no new inference.')
    parser.add_argument('--new-case-existing', type=Path, help='Explicit new test after a known failure; retain the shared budget.')
    parser.add_argument('--request-limit', type=int, choices=(5, 8, 9, 12, 13), default=8,
        help='Each real run requires explicit approval; semantic retest is bounded to at most 9 requests.')
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()
    if sum((args.closeout_comparison, args.phase7_paired, args.release_paired)) > 1:
        parser.error('choose one paired fixture')
    if args.closeout_comparison or args.phase7_paired or args.release_paired:
        args.portfolio_comparison = True
    if not args.real and not args.prepare_only:
        parser.error('--real is required; there is no automatic paid test')
    if (args.serve or args.serve_existing or args.ui_case_existing or args.read_only_existing) and (not args.real or args.prepare_only):
        parser.error('serving an inference-capable test API requires explicit --real')
    if args.semantic_retest and (args.serve or args.serve_existing or args.ui_case_existing or args.new_case_existing or args.request_limit > 9):
        parser.error('semantic retest uses a new isolated workspace, at most 9 requests and no server switch')
    if args.request_limit == 9 and not args.semantic_retest:
        parser.error('9-request budget is only available for the reviewed semantic retest')
    if args.request_limit == 13 and not args.ui_case_existing:
        parser.error('13-request shared budget is only available for explicitly authorized UI cases')
    if args.ui_case_existing and (args.serve_existing or args.new_case_existing or args.serve):
        parser.error('UI case cannot be combined with other run/serve modes')
    if args.portfolio_comparison and (args.request_limit != 5 or args.semantic_retest or args.serve
        or args.serve_existing or args.ui_case_existing or args.new_case_existing or args.read_only_existing):
        parser.error('portfolio comparison requires a new workspace, exactly 5 reserved requests and no server')
    if args.request_limit == 5 and not (args.portfolio_comparison or args.read_only_existing):
        parser.error('5-request budget is only available for portfolio comparison or its read-only archive')
    if args.read_only_existing and (args.semantic_retest or args.serve or args.serve_existing or args.ui_case_existing or args.new_case_existing):
        parser.error('read-only archive cannot be combined with another mode')
    from app.core import database, settings as core
    from app.modules.ai_settings import load_ai_settings, sanitize_ai_settings
    from app.modules.ai_journal.service import LEGACY_MAX_OUTPUT_TOKENS, model_fingerprint
    from app.modules.ai_journal.agent.model import build_agent_model, runtime_available, probe, output_limit_for
    from app.modules.ai_journal.agent.deepseek import wire_messages
    from app.modules.privacy_policy import ensure_ai_inference_allowed
    fixture_file = RELEASE_PAIR_FILE if args.release_paired else PHASE7_PAIR_FILE if args.phase7_paired else CLOSEOUT_FILE
    fixture = json.loads(fixture_file.read_text()) if (args.closeout_comparison or args.phase7_paired or args.release_paired) else None
    if fixture and (fixture.get('synthetic') is not True or fixture.get('schema_version') != 1):
        raise SystemExit('Explicit synthetic paired fixture required')
    if args.release_paired and Decimal(str(fixture['quote'])) != Decimal(str(fixture['bar_count'])):
        raise SystemExit('Release fixture quote must agree with its generated final close')
    key = fixture['instrument_key'] if fixture else KEY
    ticker = fixture['ticker'] if fixture else 'NVDA'
    if not runtime_available():
        raise SystemExit('Python 3.12 and optional Agent dependencies required')
    original_db = database.DB_PATH
    config = load_ai_settings()
    ensure_ai_inference_allowed()
    if config['provider'] != 'deepseek' or config['complexModel'] != 'deepseek-flash' or config['protocol'] != 'chat/completions':
        raise SystemExit('Configuration differs from reviewed DeepSeek Flash test')
    fingerprint = model_fingerprint(config)
    output_limit = output_limit_for(config)
    verified_capability = None
    if args.semantic_retest or args.portfolio_comparison:
        from app.modules.ai_journal.store import JournalStore
        from app.modules.ai_journal.agent.store import AgentStore
        from app.modules.ai_journal.agent.model import ready
        verified_capability = AgentStore(JournalStore()).capability(fingerprint)
        if not ready(config, verified_capability):
            raise SystemExit('Current configuration has no matching verified capability; no automatic probe')
    existing = args.serve_existing or args.ui_case_existing or args.new_case_existing or args.read_only_existing
    home = existing.resolve() if existing else Path(tempfile.mkdtemp(prefix='deepseek-verification-', dir=ROOT / 'storage/local')).resolve()
    if not home.is_relative_to((ROOT / 'storage/local').resolve()):
        raise SystemExit('Test workspace must be under storage/local')
    summary = json.loads((home / 'verification.json').read_text()) if existing else {
        'synthetic_only': True, 'fingerprint': fingerprint, 'max_requests': args.request_limit,
        'requests_reserved': 0, 'closed': False, 'calls': [], 'workspace': str(home)}
    if summary['fingerprint'] != fingerprint or not summary['synthetic_only']:
        raise SystemExit('Test workspace/configuration mismatch')
    summary['max_requests'] = args.request_limit
    if fixture:
        summary.update(fixture_id=fixture['id'], expected=fixture['expected'],
            review_criteria=fixture['review_criteria'], legacy_timeout_seconds=120,
            agent_timeout_seconds_per_call=25, agent_run_deadline_seconds=90,
            output_limit_per_request=output_limit, request_bytes_limit=40000)
        summary.update(legacy_output_limit=LEGACY_MAX_OUTPUT_TOKENS, legacy_reasoning_effort='low', agent_reasoning_effort='provider_default')
    lock = threading.Lock()

    def persist():
        (home / 'verification.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2))

    def check_config():
        with sqlite3.connect(f'file:{original_db}?mode=ro', uri=True) as db:
            payload = db.execute('select payload from app_state where key=?', ('ai_settings_v1',)).fetchone()
        current = sanitize_ai_settings(json.loads(payload[0]) if payload else {})
        if model_fingerprint(current) != fingerprint:
            raise ValueError('configuration_changed')

    def factory(settings, capability, *, probing=False):
        underlying = build_agent_model(settings, capability, probing=probing)
        local_calls = 0
        async def call(messages, tools):
            nonlocal local_calls
            check_config()
            body = {'model': settings['complexModel'], 'messages': wire_messages(messages),
                    'max_tokens': output_limit, 'stream': False, **({'tools': tools} if tools else {})}
            byte_count = len(json.dumps(body, ensure_ascii=False).encode())
            with lock:
                if summary['closed'] or summary['requests_reserved'] >= summary['max_requests'] or byte_count > 40000 or (args.serve_existing and local_calls >= 2):
                    raise ValueError('test_admission_closed')
                local_calls += 1
                summary['requests_reserved'] += 1
                entry = {'request': summary['requests_reserved'], 'input_bytes': byte_count,
                    'prior_assistant_messages': sum(row['role'] == 'assistant' for row in body['messages']),
                    'prior_reasoning_fields': sum('reasoning_content' in row for row in body['messages'])}
                summary['calls'].append(entry)
                persist()
            started = time.monotonic()
            try:
                reply = await underlying(messages, tools)
                check_config()
            except BaseException:
                with lock:
                    summary['closed'] = True
                    entry['outcome'] = 'failed_or_unknown_no_replay'
                    persist()
                raise
            if not reply.tool_calls and not probing:
                from app.modules.ai_journal.agent.contracts import Report
                from pydantic import ValidationError
                try:
                    report = Report.model_validate_json(reply.text)
                    observed = set()
                    for row in body['messages']:
                        if row['role'] == 'tool':
                            observed.update(source['id'] for source in json.loads(row['content']).get('sources', []))
                    cited = {value for rows in (report.facts, report.interpretations, report.risks)
                        for row in rows for value in row.source_ids}
                    entry['report_schema_valid'] = True
                    entry['unobserved_citation_count'] = len(cited - observed)
                except ValidationError as exc:
                    entry['report_schema_valid'] = False
                    entry['validation_errors'] = [{'field': list(row['loc']), 'type': row['type']}
                        for row in exc.errors(include_input=False, include_context=False, include_url=False)[:8]]
            with lock:
                entry.update(outcome='received', usage=reply.usage_metadata,
                    duration_ms=int((time.monotonic() - started) * 1000),
                    returned_model=reply.response_metadata.get('model_name'),
                    finish_reason=reply.response_metadata.get('finish_reason'),
                    reasoning_present=bool(reply.additional_kwargs['deepseek_message'].get('reasoning_content')),
                    tool_names=[row['name'] for row in reply.tool_calls])
                persist()
            return reply
        return call

    # Credential lookup happens before switching all runtime paths to the synthetic workspace.
    core.DATA_HOME = home
    core.DB_PATH = database.DB_PATH = home / 'synthetic.db'
    os.environ['STOCK_APP_DATA_HOME'] = str(home)
    os.environ['STOCK_APP_DB_PATH'] = str(core.DB_PATH)
    database.init_db()
    from app.modules.trading_data import save_trading_state
    save_trading_state({'privacyMode': 'normal', 'account': {'baseCurrency': 'USD'},
        'stockPool': [ticker], 'positions': [{'ticker': ticker, 'targetWeight': fixture['target_weight'] if fixture else .3,
            'takeProfitPct': fixture['take_profit'] if fixture else .2, 'stopLossPct': fixture['stop_loss'] if fixture else .1}],
        'trades': [{'id': 'synthetic-buy', 'ticker': ticker, 'date': fixture['trade_date'] if fixture else '2020-01-01',
            'action': '买入', 'shares': fixture['quantity'] if fixture else 10, 'unitPrice': fixture['unit_cost'] if fixture else 12,
            'amount': float(Decimal(str(fixture['quantity'])) * Decimal(str(fixture['unit_cost']))) if fixture else 120,
            'note': fixture['trade_reason'] if fixture else '合成买入理由：英伟达长期算力需求；只有需求和盈利持续才继续持有。'}]})
    from app.modules.market_board.models import Instrument, Series
    from app.modules.market_board.store import BoardStore
    from app.modules.ai_journal.store import JournalStore
    from app.modules.ai_journal.service import JournalService
    from app.modules.ai_journal.agent.store import AgentStore
    from app.modules.ai_journal.agent.manager import JournalAgentManager
    from app.modules.ai_journal.models import PreviewRequest, ConfirmRequest
    stamp = datetime.fromisoformat(fixture['observation_at']) if fixture else datetime.now(timezone.utc) - timedelta(minutes=1)
    instrument = Instrument(key=key, symbol=ticker, name=fixture['name'] if fixture else 'NVIDIA synthetic fixture', market='US',
        exchange=key.split(':')[1], asset_type='STOCK', currency='USD', timezone='America/New_York', verified_at=stamp)
    board_store = BoardStore(core.DB_PATH)
    board_store.save_instruments([instrument])

    class SyntheticBoard:
        store = board_store
        catalog = SimpleNamespace(resolve=lambda value: instrument if value == key else None)

        def detail(self, value):
            if value != key:
                raise ValueError('synthetic_identity_invalid')
            return SimpleNamespace(model_dump=lambda **_: {'row': {'instrument': instrument.model_dump(mode='json'),
                'quote': {'price': fixture['quote'] if fixture else 20, 'currency': 'USD', 'meta': {'source': 'explicit-synthetic-test',
                    'status': 'available', 'as_of': stamp.isoformat(), 'fetched_at': stamp.isoformat()}}}})

        def series(self, value, period, range_):
            if (value, period) != (key, '1d'):
                raise ValueError('synthetic_identity_invalid')
            count = fixture['bar_count'] if fixture else 20
            dates = []
            date = stamp if fixture else stamp - timedelta(days=1)
            while len(dates) < count:
                if not fixture or date.weekday() < 5:
                    dates.append(date)
                date -= timedelta(days=1)
            dates.reverse()
            return Series.model_validate({'instrument_key': key, 'period': period, 'range': range_,
                'currency': 'USD', 'timezone': 'America/New_York', 'adjustment': 'split_adjusted',
                'meta': {'source': 'explicit-synthetic-test', 'status': 'available',
                    'as_of': stamp.isoformat(), 'fetched_at': stamp.isoformat()},
                'bars': [{'time': date.isoformat(), 'open': str(i+1),
                    'close': str(i+1), 'high': str(i+2), 'low': str(i+.5), 'is_final': True} for i, date in enumerate(dates)]})

    journal = JournalStore()
    if not existing:
        note_id = journal.save_note(fixture['note'] if fixture else '合成原文：NVDA 英伟达买入理由是长期算力需求。若需求持续减弱需重新核对计划。')['id']
        if args.semantic_retest or args.portfolio_comparison:
            with journal.connect() as db:
                db.execute('update ai_journal_notes set created_at=?,updated_at=? where id=?',
                    ((fixture['note_version_at'],) * 2 + (note_id,)) if fixture else
                    ('2026-09-01T00:00:00+00:00', '2026-09-01T00:00:00+00:00', note_id))
    board = SyntheticBoard()
    store = AgentStore(journal)
    service = JournalService(journal, board, settings=lambda: config)
    manager = JournalAgentManager(journal, settings=lambda: config, model_factory=factory)
    if verified_capability is not None:
        store.save_capability(verified_capability.model_dump())
        (home / 'capability.json').write_text(verified_capability.model_dump_json(indent=2))
    persist()

    def serve_api():
        from app import main as api
        from app.modules.ai_settings import public_ai_settings
        from app.modules.ai_journal import router
        from app.modules.ai_journal.agent import manager as manager_module
        from app.modules.ai_journal.agent.runtime import Budget
        router._store, router._service, router.board_service = journal, service, board
        api.journal_agent_manager = manager
        api.get_ai_settings_public = lambda: public_ai_settings(config)
        # Test-only run bounds fit the remaining explicitly approved request budget.
        manager_module.Budget = lambda: Budget(max_model_calls=min(4 if args.ui_case_existing else 2, max(1,
            summary['max_requests'] - summary['requests_reserved'])))
        def disable_inference(*_, **__):
            from fastapi import HTTPException
            raise HTTPException(403, detail='synthetic_test_agent_only')
        api.create_ai_chat_reply = api.create_external_ai_advice = api.recognize_position_screenshot = disable_inference
        @api.app.middleware('http')
        async def restrict_test_inference(request, call_next):
            if args.read_only_existing and request.method not in {'GET', 'HEAD', 'OPTIONS'}:
                from fastapi.responses import JSONResponse
                return JSONResponse(status_code=403, content={'detail': 'synthetic_archive_read_only'})
            if request.method == 'POST' and request.url.path in {
                '/api/ai-journal/agent-capabilities/test', '/api/ai-settings/test',
                '/api/quant-analysis/runs', '/api/research-settings/test'}:
                from fastapi.responses import JSONResponse
                return JSONResponse(status_code=403, content={'detail': 'synthetic_test_budget_closed_for_other_inference'})
            return await call_next(request)
        import uvicorn
        uvicorn.run(api.app, host='127.0.0.1', port=args.port, log_level='warning')

    if args.read_only_existing:
        review = json.loads((home / 'review.json').read_text())
        if (summary.get('status') not in {'completed_awaiting_review', 'stopped_no_replay'} or not summary.get('closed')
            or not any(case.get('run_id') and case.get('status') == 'succeeded' for case in summary.get('cases', []))
            or review.get('status') not in {'reviewed', 'reviewed_with_findings'}):
            raise SystemExit('Read-only serving requires a closed, completed and manually reviewed comparison')
        with journal.connect() as db:
            active = db.execute("select count(*) from ai_journal_agent_runs where status in ('queued','running','cancel_requested')").fetchone()[0]
        if active:
            raise SystemExit('Read-only serving refuses unfinished Agent runs')
        try:
            serve_api()
        finally:
            manager.stop()
        return
    if args.serve_existing or args.ui_case_existing:
        if args.ui_case_existing:
            review = json.loads((home / 'review.json').read_text())
            if (summary.get('status') != 'completed_awaiting_review' or not summary.get('execution_checks_passed')
                or review.get('status') not in {'reviewed', 'reviewed_with_findings'}
                or any(row.get('outcome') != 'received' for row in summary['calls'])
                or summary['requests_reserved'] >= summary['max_requests']):
                raise SystemExit('UI cases require a reviewed successful workspace and a new bounded budget')
            summary['ui_start_requests'] = summary['requests_reserved']
            summary['closed'] = False
            persist()
        elif summary.get('status') != 'succeeded' or summary['closed']:
            raise SystemExit('Unsuccessful/unknown runs cannot be resumed or replayed')
        try:
            serve_api()
        finally:
            manager.stop()
            if args.ui_case_existing:
                summary['closed'] = True
            persist()
        return
    if args.prepare_only:
        question = fixture['question'] if fixture else PORTFOLIO_QUESTION if args.portfolio_comparison else SEMANTIC_QUESTION if args.semantic_retest else QUESTION
        preview = service.preview(PreviewRequest(task_type='conversation', question=question,
            engine='agent', auto_context=True, memory_mode='suggest_related'))
        print(json.dumps({'workspace': str(home), 'requests': 0, 'scope': preview['agent_scope'],
            'fixture_id': fixture['id'] if fixture else None,
            'question': question, 'expected': fixture['expected'] if fixture else None,
            'legacy_timeout_seconds': 120 if fixture else 25,
            'agent_output_limit': output_limit, 'legacy_output_limit': LEGACY_MAX_OUTPUT_TOKENS,
            'legacy_reasoning_effort': 'low',
            'semantic_questions': [SEMANTIC_QUESTION, FOLLOWUP_QUESTION] if args.semantic_retest else [],
            'max_requests': args.request_limit, 'capability_reused': verified_capability is not None,
            'source_kinds': [row['kind'] for row in preview['agent_sources']]}), flush=True)
        return
    if args.semantic_retest or args.portfolio_comparison:
        try:
            run_semantic_retest(service, journal, store, manager, config, summary, persist, check_config, lock,
                portfolio=args.portfolio_comparison, fixture=fixture,
                test_name='release_paired_comparison' if args.release_paired else 'phase7_paired_comparison' if args.phase7_paired else None)
        finally:
            manager.stop()
            persist()
        return
    try:
        if args.new_case_existing:
            if summary['closed'] or summary.get('status') != 'failed' or any(row.get('outcome') != 'received' for row in summary['calls']):
                raise SystemExit('Only a known terminal failure permits an explicit new case')
            summary.setdefault('prior_cases', []).append({key: summary.get(key) for key in (
                'run_id', 'session_id', 'status', 'usage', 'tools', 'source_kinds', 'required_tools_passed')})
        else:
            cap = asyncio.run(probe(config, 'chat/completions', check_config, model_factory=factory))
            store.save_capability(cap.model_dump())
            (home / 'capability.json').write_text(cap.model_dump_json(indent=2))
        preview = service.preview(PreviewRequest(task_type='conversation', question=QUESTION,
            engine='agent', auto_context=True, memory_mode='suggest_related'))
        request = ConfirmRequest(snapshot_id=preview['id'], digest=preview['digest'], idempotency_key='synthetic-' + preview['id'])
        session = service.confirm(request)
        run_id = session['turns'][0]['run_id']
        manager.execute(run_id)
        run = store.get(run_id)
        sources = store.sources(run_id)
        summary.update(run_id=run_id, session_id=session['id'], status=run['status'], usage=run['usage'],
            tools=run['events'], source_kinds=[row['kind'] for row in sources],
            source_count=len(sources), report_valid=run['result'] is not None)
        expected = {'read_portfolio_snapshot', 'read_investment_policy', 'search_investment_memory',
            'get_market_facts', 'calculate_portfolio_exposure', 'get_price_series', 'calculate_indicators'}
        summary['required_tools_passed'] = expected.issubset({row['tool'] for row in run['events'] if row['status'] == 'succeeded'})
        for row in sources:
            if row['kind'] == 'calculation' and row['payload'].get('method', '').startswith('quantity-times'):
                group = row['payload']['groups'][0]
                summary['exposure_expected'] = Decimal(group['market_value']) == 200 and Decimal(group['holding_cost']) == 120 and Decimal(group['positions'][0]['weight_within_currency']) == 1
            elif row['kind'] == 'calculation' and 'ma20' in row['payload']:
                summary['indicators_expected'] = row['payload']['ma20'] == '10.5' and row['payload']['ma60'] is None
        with journal.connect() as db:
            dump = '\n'.join(db.iterdump())
        summary['archive_excludes_reasoning_and_key'] = 'reasoning_content' not in dump and config['apiKey'] not in dump
        summary['idempotent_confirmation'] = service.confirm(request)['turns'][0]['run_id'] == run_id
        persist()
        print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
        if run['status'] != 'succeeded' or not summary['required_tools_passed']:
            raise SystemExit('Full synthetic Agent validation did not pass; no automatic replay')
        if args.serve:
            serve_api()
    finally:
        manager.stop()
        persist()


def run_semantic_retest(service, journal, store, manager, config, summary, persist, check_config, lock, *, portfolio=False, fixture=None, test_name=None):
    from unittest.mock import patch
    from app.modules import ai_settings
    from app.modules.ai_journal.models import PreviewRequest, ConfirmRequest
    from app.modules.ai_journal.service import LEGACY_MAX_OUTPUT_TOKENS, model_fingerprint
    output_limit = LEGACY_MAX_OUTPUT_TOKENS
    summary.update(test=test_name or ('phase6_portfolio_comparison' if portfolio else 'phase6_semantic_two_turn_and_legacy'), cases=[], capability_reused=True,
        semantic_review='pending', current_services_changed=False)
    first = None
    session_id = None
    questions = (fixture['question'] if fixture else PORTFOLIO_QUESTION,) if portfolio else (SEMANTIC_QUESTION, FOLLOWUP_QUESTION)
    for index, question in enumerate(questions):
        preview = service.preview(PreviewRequest(task_type='conversation', question=question,
            engine='agent', auto_context=True, session_id=session_id, memory_mode='suggest_related'))
        if first is None:
            first = copy.deepcopy(preview)
        request = ConfirmRequest(snapshot_id=preview['id'], digest=preview['digest'], idempotency_key='synthetic-' + preview['id'])
        session = service.confirm(request, session_id)
        session_id = session['id']
        run_id = session['turns'][-1]['run_id']
        before = summary['requests_reserved']
        started = time.monotonic()
        manager.execute(run_id)
        run = store.get(run_id)
        sources = store.sources(run_id)
        case = {'case': 'portfolio' if portfolio else 'memory_dates' if index == 0 else 'tool_followup', 'run_id': run_id,
            'session_id': session_id, 'status': run['status'], 'error_code': run['error_code'],
            'requests': summary['requests_reserved'] - before, 'usage': run['usage'], 'tools': run['events'],
            'source_count': len(sources), 'source_kinds': [row['kind'] for row in sources],
            'duration_ms': int((time.monotonic() - started) * 1000),
            'history_turn_count': len(preview.get('agent_history', [])),
            'semantic_review': 'pending'}
        if index == 0:
            case['memory_sources_passed'] = {'note', 'trade_reason'}.issubset(case['source_kinds'])
        if run['status'] == 'succeeded':
            case['idempotent_confirmation'] = service.confirm(request, preview['request']['session_id'])['turns'][-1]['run_id'] == run_id
        if index == 1 or portfolio:
            expected = {'read_portfolio_snapshot', 'read_investment_policy', 'get_market_facts',
                'calculate_portfolio_exposure', 'get_price_series', 'calculate_indicators'}
            if portfolio:
                expected.add('search_investment_memory')
            case['required_tools_passed'] = expected.issubset({row['tool'] for row in run['events'] if row['status'] == 'succeeded'})
            for source in sources:
                payload = source['payload']
                if source['kind'] == 'calculation' and 'ma20' in payload:
                    expected = fixture['expected'] if fixture else {'ma5': '18', 'ma20': '10.5', 'ma60': None}
                    case['indicators_expected'] = all(payload[name] == expected[name] for name in ('ma5', 'ma20', 'ma60'))
                if source['kind'] == 'calculation' and payload.get('method', '').startswith('quantity-times'):
                    group = payload['groups'][0]
                    expected = fixture['expected'] if fixture else {'market_value': '200', 'holding_cost': '120', 'weight_within_currency': '1'}
                    case['exposure_expected'] = (Decimal(group['market_value']) == Decimal(expected['market_value'])
                        and Decimal(group['holding_cost']) == Decimal(expected['holding_cost'])
                        and Decimal(group['positions'][0]['weight_within_currency']) == Decimal(expected['weight_within_currency']) and payload['cash'] is None)
        summary['cases'].append(case)
        persist()
        if run['status'] != 'succeeded':
            summary['closed'] = True
            summary['status'] = 'stopped_no_replay'
            persist()
            raise SystemExit('Semantic test stopped at terminal/unknown run; no replay or further inference')

    # Same frozen evidence and question, with the existing legacy prompt/HTTP path.
    baseline = copy.deepcopy(first)
    for key in ('id', 'digest'):
        baseline.pop(key, None)
    baseline['request']['engine'] = 'llm'
    baseline['request']['memory_mode'] = 'selected'
    now = datetime.now(timezone.utc)
    baseline['created_at'], baseline['expires_at'] = now.isoformat(), (now + timedelta(minutes=5)).isoformat()
    baseline = journal.save_snapshot(baseline, model_fingerprint(config))
    original_post = ai_settings.requests.post
    baseline_entry = None

    def bounded_post(url, **kwargs):
        nonlocal baseline_entry
        check_config()
        body = kwargs['json']
        size = len(json.dumps(body, ensure_ascii=False).encode())
        if (url != 'https://api.deepseek.com/v1/chat/completions' or body.get('model') != config['complexModel']
            or body.get('max_tokens') != output_limit or body.get('reasoning_effort') != 'low' or size > 40000):
            raise ValueError('legacy_test_payload_invalid')
        with lock:
            if baseline_entry is not None or summary['closed'] or summary['requests_reserved'] >= summary['max_requests']:
                raise ValueError('test_admission_closed')
            summary['requests_reserved'] += 1
            baseline_entry = {'request': summary['requests_reserved'], 'engine': 'legacy_llm', 'input_bytes': size}
            summary['calls'].append(baseline_entry)
            persist()
        started = time.monotonic()
        try:
            response = original_post(url, **kwargs)
            response.raise_for_status()
            payload = response.json()
            check_config()
            baseline_entry.update(outcome='received', usage=payload.get('usage'), returned_model=payload.get('model'),
                finish_reason=(payload.get('choices') or [{}])[0].get('finish_reason'),
                duration_ms=int((time.monotonic() - started) * 1000))
            persist()
            if baseline_entry['finish_reason'] == 'length':
                raise ai_settings.IncompleteCompletionError('legacy_test_output_truncated')
            return response
        except BaseException as exc:
            summary['closed'] = True
            baseline_entry['error_type'] = type(exc).__name__
            if baseline_entry.get('outcome') != 'received':
                baseline_entry['outcome'] = ('outcome_unknown' if isinstance(exc,
                    (ai_settings.requests.Timeout, ai_settings.requests.ConnectionError)) else 'failed_or_unknown_no_replay')
            baseline_entry['continuation'] = 'stopped_no_replay'
            persist()
            raise

    def completion(**kwargs):
        kwargs.update(timeout=120 if fixture else 25, max_output_tokens=output_limit, protocol='chat/completions')
        return ai_settings.call_openai_compatible_completion(**kwargs)

    request = ConfirmRequest(snapshot_id=baseline['id'], digest=baseline['digest'], idempotency_key='synthetic-' + baseline['id'])
    from app.modules.ai_journal.service import JournalService
    legacy = JournalService(journal, service.board, settings=lambda: config, completion=completion)
    started = time.monotonic()
    with patch('app.modules.ai_settings.requests.post', bounded_post):
        result = legacy.confirm(request)
    turn = result['turns'][0]
    summary['cases'].append({'case': 'legacy_portfolio' if portfolio else 'legacy_memory_dates', 'session_id': result['id'], 'turn_id': turn['id'],
        'status': turn['status'], 'error_code': turn['error_code'], 'requests': 1 if baseline_entry else 0,
        'duration_ms': int((time.monotonic() - started) * 1000), 'same_frozen_evidence':
            all(baseline[key] == first[key] for key in ('private_context', 'facts', 'missing', 'agent_sources')),
        'same_question': baseline['request']['question'] == first['request']['question'],
        'output_limit_test_override': None, 'output_limit': output_limit, 'timeout_seconds': 120 if fixture else 25,
        'timeout_test_override_seconds': None if fixture else 25, 'semantic_review': 'pending'})
    if baseline_entry and baseline_entry.get('outcome') == 'outcome_unknown':
        summary['cases'][-1]['transport_outcome'] = 'outcome_unknown'
        summary['cases'][-1]['usage_complete'] = False
    with journal.connect() as db:
        dump = '\n'.join(db.iterdump())
    summary['archive_excludes_reasoning_and_key'] = 'reasoning_content' not in dump and config['apiKey'] not in dump
    calculation_case = summary['cases'][0 if portfolio else 1]
    agent_cases = summary['cases'][:-1]
    summary['execution_checks_passed'] = (summary['cases'][0].get('memory_sources_passed') is True
        and all(calculation_case.get(key) is True for key in ('required_tools_passed', 'indicators_expected', 'exposure_expected'))
        and all(case.get('idempotent_confirmation') is True for case in agent_cases)
        and (portfolio or summary['cases'][1]['history_turn_count'] == 1)
        and summary['cases'][-1]['same_frozen_evidence'] is True
        and summary['cases'][-1]['same_question'] is True
        and turn['status'] == 'completed'
        and summary['requests_reserved'] <= summary['max_requests']
        and summary['archive_excludes_reasoning_and_key'])
    summary['status'] = 'completed_awaiting_review' if turn['status'] == 'completed' else 'stopped_no_replay'
    summary['closed'] = True
    persist()
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    main()
