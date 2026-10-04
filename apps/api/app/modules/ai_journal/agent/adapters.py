from __future__ import annotations

from app.modules.privacy_policy import ensure_ai_inference_allowed
from app.modules.trading_data import load_trading_state, derive_positions
from .contracts import Evidence
from .runtime import AccessRevoked
from .memory import retrieve


def private_access(snapshot, journal, state_loader=load_trading_state):
    state = state_loader()
    try:
        ensure_ai_inference_allowed(state)
    except Exception:
        raise AccessRevoked('privacy_revoked') from None
    private = snapshot['private_context']
    if private.get('workspace_position_signature'):
        from ..automatic import position_signature
        if position_signature(state) != private['workspace_position_signature']:
            raise AccessRevoked('private_scope_revoked')
    with journal.connect() as db:
        for frozen in private.get('notes', []):
            current = db.execute('select id,body,updated_at from ai_journal_notes where id=? and deleted_at is null', (frozen['id'],)).fetchone()
            if not current or dict(current) != frozen:
                raise AccessRevoked('private_scope_revoked')
    trades = {row['id']: row for row in state.get('trades', [])}
    for frozen in private.get('trade_reasons', []):
        current = trades.get(frozen['id'])
        if not current or {key: current.get(key) for key in ('id', 'ticker', 'date', 'note')} != frozen:
            raise AccessRevoked('private_scope_revoked')
    if private.get('positions'):
        positions = {row['ticker']: row for row in derive_positions(state)}
        for frozen in private['positions']:
            current = positions.get(frozen['ticker'])
            if not current or current['shares'] != frozen['quantity'] or current['costBasis'] != frozen['cost'] or current['assetType'] != frozen['instrument_key'].rsplit(':', 1)[-1] or state.get('account', {}).get('baseCurrency') != frozen['currency']:
                raise AccessRevoked('private_scope_revoked')
    plans = {row['ticker']: row for row in state.get('positions', [])}
    for frozen in private.get('plans', []):
        current = plans.get(frozen['ticker'])
        if not current or {key: value for key, value in current.items() if key in ('ticker', 'targetWeight', 'takeProfitPct', 'stopLossPct')} != frozen:
            raise AccessRevoked('private_scope_revoked')


def frozen_ports(snapshot, check_access):
    if snapshot['agent_scope']['refresh_market']:
        raise ValueError('agent_refresh_not_ready')
    rows = [Evidence.model_validate(value) for value in snapshot['agent_sources']]
    scope = snapshot['agent_scope']
    allowed_keys = set(scope['instrument_keys'])

    def live_rows():
        check_access()
        return rows

    def check_key(key):
        if key not in allowed_keys:
            raise ValueError('instrument_not_authorized')

    async def read_private(kind):
        return [row for row in live_rows() if row.kind == {'positions': 'position', 'plans': 'policy'}[kind]]

    async def read_market(key):
        check_key(key)
        return [row for row in live_rows() if row.kind == 'quote' and row.payload.get('instrument_key') == key]

    async def read_news(key):
        check_key(key)
        return [row for row in live_rows() if row.kind == 'news' and row.payload.get('instrument_key') == key]

    async def read_series(key, period):
        check_key(key)
        if period not in scope['periods_by_key'].get(key, []):
            raise ValueError('period_not_authorized')
        selected = [row for row in live_rows() if row.kind == 'series' and row.payload.get('instrument_key') == key and row.payload.get('period') == period]
        if len(selected) != 1:
            raise ValueError('frozen_series_unavailable')
        return selected[0]

    async def search_memory(query, **filters):
        selected = [row for row in live_rows() if row.kind in {'note', 'trade_reason'} and row.id in scope['memory_source_ids']]
        return retrieve(query, selected, **filters)

    return {'read_private': read_private, 'read_market': read_market,
            'read_series': read_series, 'search_memory': search_memory, 'read_news': read_news}
