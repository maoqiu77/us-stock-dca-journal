from __future__ import annotations

from datetime import datetime, timedelta, timezone
from app.modules.ai_settings import load_ai_settings, call_openai_compatible_completion
from .context import private_context, market_facts, usable
from .prompts import messages
from .store import digest, fail


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
            if session['task_type'] != request.task_type or session['instrument_key'] != request.instrument_key:
                fail('session_scope_mismatch', 422)
        private, missing = private_context(self.store, self.board, request)
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
            keys = [request.instrument_key] if instrument else [row['instrument_key'] for row in private.get('positions', [])]
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
        if not facts:
            missing.append('没有可靠市场事实，仅可进行一般性讨论，不生成价格或价位判断。')
        payload = {
            'request': request.model_dump(mode='json'), 'instrument': instrument.model_dump(mode='json') if instrument else None,
            'facts': facts, 'private_context': private, 'missing': list(dict.fromkeys(missing)),
            'model': model_identity(settings), 'ai_configured': bool(settings.get('apiKey') and settings.get('baseUrl') and model_identity(settings)['model']),
            'created_at': stamp.isoformat(), 'expires_at': (stamp + timedelta(minutes=5)).isoformat(), 'facts_origin': origin,
        }
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
            if previous['status'] != 'failed':
                return self.store.session(previous['session_id'])
        if self.clock() > datetime.fromisoformat(snapshot['expires_at']):
            fail('snapshot_expired')
        settings = self.settings()
        if model_fingerprint(settings) != fingerprint:
            fail('preview_changed')
        session_id, turn_id, claimed = self.store.claim(request, snapshot, session_id)
        if claimed:
            if not settings.get('apiKey') or not settings.get('baseUrl') or not snapshot['model']['model']:
                self.store.finish(turn_id, error='ai_not_configured')
            else:
                try:
                    result = self.completion(**snapshot['model'], base_url=settings['baseUrl'], api_key=settings['apiKey'], messages=messages(snapshot), timeout=120, max_output_tokens=3000)
                    answer = str(result.get('content') or '').strip()
                    if not answer:
                        raise ValueError('empty response')
                    self.store.finish(turn_id, answer=answer[:24000])
                except Exception:
                    # Never persist or log provider errors containing request/private data.
                    self.store.finish(turn_id, error='model_failed')
        return self.store.session(session_id)
