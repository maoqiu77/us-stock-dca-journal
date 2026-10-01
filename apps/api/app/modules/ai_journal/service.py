from __future__ import annotations

from datetime import datetime, timedelta, timezone
from app.modules.ai_settings import (
    CompletionOutcomeUnknownError, IncompleteCompletionError,
    check_completion_complete, load_ai_settings, call_openai_compatible_completion,
)
from .context import private_context, market_facts, usable
from .prompts import messages
from .store import digest, fail

LEGACY_MAX_OUTPUT_TOKENS = 8192


def model_identity(settings):
    return {'provider': settings.get('provider', 'custom'), 'protocol': settings.get('protocol', 'auto'), 'model': settings.get('complexModel') or settings.get('model') or ''}


def model_fingerprint(settings):
    return digest({**model_identity(settings), 'url': settings.get('baseUrl'), 'key': settings.get('apiKey')})


class JournalService:
    def __init__(self, store, board, settings=None, completion=None, clock=None):
        self.store, self.board = store, board
        self.settings = settings or load_ai_settings
        self.completion = completion or call_openai_compatible_completion
        self.clock = clock or (lambda: datetime.now(timezone.utc))

    def preview(self, request):
        settings = self.settings()
        stamp = self.clock()
        instrument = None
        if request.instrument_key:
            instrument = self.board.catalog.resolve(request.instrument_key)
            if instrument is None:
                fail('unknown_instrument', 422)
            if request.cost_currency and request.cost_currency != instrument.currency:
                fail('cost_currency_mismatch', 422)
        allowed_periods = ['1d'] if instrument and instrument.market.value == 'US' else []
        periods = ([request.primary_period] if request.primary_period else []) + request.auxiliary_periods
        if any(period not in allowed_periods for period in periods):
            fail('period_not_verified', 422)
        if request.session_id:
            session = self.store.session(request.session_id)
            if session['task_type'] != request.task_type or (request.task_type != 'conversation' and session['instrument_key'] != request.instrument_key):
                fail('session_scope_mismatch', 422)
        if request.auto_context:
            from .automatic import automatic_context
            private, missing = automatic_context(self.store, self.board, request, stamp)
        else:
            private, missing = private_context(self.store, self.board, request)
            if request.engine == 'agent' and (request.memory_mode == 'suggest_related' or request.memory_before):
                from .agent.memory import candidates
                from app.modules.trading_data import load_trading_state
                from app.modules.privacy_policy import ensure_ai_inference_allowed
                state = load_trading_state()
                ensure_ai_inference_allowed(state)
                private.update(candidates(self.store, state, request, stamp))
        targets = []
        if request.task_type == 'conversation':
            from .automatic import conversation_targets
            targets = conversation_targets(self.board, request)
        facts, origin = [], None
        if request.reuse_snapshot_id:
            if not request.session_id or request.reuse_snapshot_id not in [turn['snapshot_id'] for turn in session['turns'] if turn['status'] == 'completed']:
                fail('snapshot_scope_mismatch', 422)
            previous, _, _ = self.store.snapshot(request.reuse_snapshot_id)
            for key in ('primary_period', 'auxiliary_periods', 'position_tickers'):
                if previous['request'][key] != request.model_dump(mode='json')[key]:
                    fail('reuse_scope_changed', 422)
            facts = previous['facts']
            origin = {'snapshot_id': previous['id'], 'created_at': previous['created_at']}
            missing.extend(previous['missing'])
            missing.append('复用已确认的历史市场事实，未刷新行情；保留原观察时间。')
        else:
            keys = ([request.instrument_key] if instrument else [row['instrument_key'] for row in private.get('positions', [])])
            if request.task_type == 'conversation':
                keys = targets + [row['instrument_key'] for row in private.get('positions', [])]
            for key in dict.fromkeys(keys):
                values, absent = market_facts(self.board, key)
                facts.extend(values)
                missing.extend(absent)
            for period in periods:
                series = self.board.series(request.instrument_key, period, '3mo').model_dump(mode='json')
                series['bars'] = [bar for bar in series['bars'] if bar['is_final']]
                if not usable(series) or not series['bars']:
                    fail('primary_period_unavailable' if period == request.primary_period else 'auxiliary_period_unavailable', 422)
                facts.append({'kind': '已收盘 K 线', 'instrument_key': request.instrument_key, 'value': series})
            if request.engine == 'agent' and request.task_type == 'conversation':
                for key in dict.fromkeys(targets):
                    item = self.board.catalog.resolve(key)
                    if item.market.value != 'US':
                        continue
                    try:
                        series = self.board.series(key, '1d', '3mo').model_dump(mode='json')
                        series['bars'] = [bar for bar in series['bars'] if bar['is_final']]
                        if usable(series) and series['bars']:
                            facts.append({'kind': '已收盘 K 线', 'instrument_key': key, 'value': series})
                        else:
                            missing.append(key + '：日线不可用')
                    except Exception:
                        missing.append(key + '：日线读取失败')
        if not facts:
            missing.append('没有可靠市场事实，仅可进行一般性讨论，不生成价格或价位判断。')
        payload = {
            'request': request.model_dump(mode='json'), 'instrument': instrument.model_dump(mode='json') if instrument else None,
            'facts': facts, 'private_context': private, 'missing': list(dict.fromkeys(missing)),
            'model': model_identity(settings), 'ai_configured': bool(settings.get('apiKey') and settings.get('baseUrl') and model_identity(settings)['model']),
            'created_at': stamp.isoformat(), 'expires_at': (stamp + timedelta(minutes=5)).isoformat(), 'facts_origin': origin,
            'resolved_instrument_keys': targets,
        }
        if request.engine == 'agent':
            from .agent.scope import build_scope
            payload['agent_scope'], payload['agent_sources'] = build_scope(self.board, request, private, facts, stamp, extra_keys=targets)
            # Keep non-source memory filters visible in the model's missing/status channel.
            # They describe what was excluded, never the excluded record contents.
            filter_status = ['检索过滤状态：' + item for item in payload['agent_scope'].get('memory_filter_policy', [])]
            payload['missing'] = list(dict.fromkeys(payload['missing'] + filter_status))
            from .agent.store import AgentStore
            from .agent.model import ready
            capability = AgentStore(self.store).capability(model_fingerprint(settings))
            payload['agent_available'] = ready(settings, capability) and request.market_policy == 'frozen'
            payload['agent_endpoint'] = capability.endpoint if payload['agent_available'] else None
            payload['agent_disabled_reason'] = '' if payload['agent_available'] else 'agent_execution_not_ready'
            payload['agent_history'] = [{**row, 'classification': 'ai_generated'} for row in private.get('history', [])]
        return self.store.save_snapshot(payload, model_fingerprint(settings))

    def confirm(self, request, session_id=None):
        snapshot, checksum, fingerprint = self.store.snapshot(request.snapshot_id)
        if request.digest != checksum or digest(snapshot) != checksum:
            fail('preview_changed')
        if snapshot['request']['session_id'] != session_id:
            fail('session_scope_mismatch')
        # Completed/pending retries return the same result even after expiry.
        with self.store.connect() as db:
            previous = db.execute('select * from ai_journal_turns where idempotency_key=?', (request.idempotency_key,)).fetchone()
        if previous:
            if previous['snapshot_id'] != request.snapshot_id:
                fail('idempotency_conflict')
            return self.store.session(previous['session_id'])
        if self.clock() > datetime.fromisoformat(snapshot['expires_at']):
            fail('snapshot_expired')
        settings = self.settings()
        if model_fingerprint(settings) != fingerprint:
            fail('preview_changed')
        if snapshot['request'].get('auto_context'):
            from .agent.adapters import private_access
            from .agent.runtime import AccessRevoked
            try:
                private_access(snapshot, self.store)
            except AccessRevoked:
                fail('private_scope_revoked', 403)
        if snapshot['request'].get('engine') == 'agent':
            from .agent.store import AgentStore
            from .agent.model import ready
            from .agent.adapters import private_access
            from .agent.runtime import AccessRevoked
            agent = AgentStore(self.store)
            enabled = snapshot.get('agent_available') and ready(settings, agent.capability(fingerprint)) and snapshot['request']['market_policy'] == 'frozen'
            if enabled:
                try:
                    private_access(snapshot, self.store)
                except AccessRevoked:
                    fail('private_scope_revoked', 403)
            result = agent.create(request, snapshot, fingerprint, session_id, disabled=not enabled)
            return self.store.session(result['session_id'])
        session_id, turn_id, claimed = self.store.claim(request, snapshot, session_id)
        if claimed:
            if not settings.get('apiKey') or not settings.get('baseUrl') or not snapshot['model']['model']:
                self.store.finish(turn_id, error='ai_not_configured')
            else:
                try:
                    # Reasoning models share this budget between reasoning and the visible answer.
                    reasoning = {'reasoning_effort': 'low'} if snapshot['model']['provider'] == 'deepseek' else {}
                    result = self.completion(**snapshot['model'], base_url=settings['baseUrl'], api_key=settings['apiKey'], messages=messages(snapshot), timeout=120, max_output_tokens=LEGACY_MAX_OUTPUT_TOKENS, **reasoning)
                    check_completion_complete(result)
                    answer = str(result.get('content') or '').strip()
                    if not answer:
                        raise ValueError('empty response')
                    if len(answer) > 24000:
                        raise IncompleteCompletionError('answer_storage_limit')
                    if snapshot['request'].get('auto_context'):
                        from .agent.adapters import private_access
                        private_access(snapshot, self.store)
                    self.store.finish(turn_id, answer=answer)
                except IncompleteCompletionError:
                    self.store.finish(turn_id, error='model_output_truncated')
                except CompletionOutcomeUnknownError:
                    self.store.finish(turn_id, error='model_outcome_unknown')
                except Exception:
                    # Never persist or log provider errors containing request/private data.
                    self.store.finish(turn_id, error='model_failed')
        return self.store.session(session_id)
