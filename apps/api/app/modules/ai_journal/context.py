from __future__ import annotations

from app.modules.trading_data import load_trading_state, derive_positions, LEGACY_HISTORY_WARNING
from .store import fail


def usable(value):
    meta = value.get('meta') or {}
    return meta.get('status') in ('available', 'partial', 'stale') and bool(meta.get('as_of') or value.get('nav_date') or value.get('report_date') or value.get('reference_date') or value.get('shares_date'))


def market_facts(board, key):
    detail = board.detail(key).model_dump(mode='json')
    row = detail['row']
    facts, missing = [], []

    def add(kind, value):
        if value and usable(value):
            facts.append({'kind': kind, 'instrument_key': key, 'value': value})
        else:
            missing.append(kind + '：缺失、示例或观察日期未知，不作为市场事实')

    if row['instrument']['asset_type'] == 'FUND':
        add('正式净值（非盘中价格）', row.get('nav'))
        add('渠道申购限额（仅限标明渠道）', row.get('purchase_limit'))
        holdings = detail.get('holdings')
        if holdings:
            add('季度重仓披露（非实时持仓）', {k: v for k, v in holdings.items() if k not in ('allocation', 'allocation_meta')})
            add('资产配置披露', {'allocation': holdings.get('allocation'), 'report_date': (holdings.get('allocation') or {}).get('report_date'), 'meta': holdings.get('allocation_meta')})
    else:
        add('交易报价', row.get('quote'))
        metrics = row.get('metrics')
        if metrics:
            # Each independently sourced field must pass its own quality gate.
            add('供应商参考溢价（非同步实时溢价）', {k: metrics.get(k) for k in ('premium_pct', 'premium_basis', 'reference_value', 'reference_date', 'basis_id', 'meta')})
            for field in ('nav', 'iopv', 'vendor_reference'):
                add('ETF ' + field, metrics.get(field))
            add('交易所份额披露', {**{k: metrics.get(k) for k in ('shares', 'shares_date', 'shares_change', 'previous_shares_date')}, 'meta': metrics.get('shares_meta')})
    return facts, missing


def available_positions(board, state):
    base_currency = state.get('account', {}).get('baseCurrency')
    rows, excluded = [], []
    # Only consult the local verified directory: no guessed exchange or suffix.
    with board.store._connect() as db:
        keys = [row[0] for row in db.execute('select key from board_instruments')]
    instruments = [board.catalog.resolve(key) for key in keys]
    for position in derive_positions(state):
        if position['shares'] <= 0:
            continue
        matches = [item for item in instruments if item and item.symbol == position['ticker'] and item.currency == base_currency and item.asset_type.value == position['assetType']]
        if len(matches) != 1:
            excluded.append({'ticker': position['ticker'], 'reason': '目录身份不唯一、币种不匹配或逐笔币种无法核实'})
            continue
        rows.append({'ticker': position['ticker'], 'instrument_key': matches[0].key, 'currency': base_currency, 'quantity': position['shares'], 'cost': position['costBasis']})
    return rows, excluded


def private_context(store, board, request, *, state=None):
    selected = {}
    missing = []
    if request.position_tickers or request.plan_tickers or request.trade_ids:
        missing.append(LEGACY_HISTORY_WARNING)
        if state is None:
            state = load_trading_state()
        positions, excluded = available_positions(board, state)
        allowed = {p['ticker']: p for p in positions}
        if any(ticker not in allowed for ticker in request.position_tickers + request.plan_tickers):
            fail('position_scope_unavailable', 422)
        selected['positions'] = [allowed[ticker] for ticker in dict.fromkeys(request.position_tickers)]
        if request.position_tickers:
            missing.append('旧账本仅有账户基准币种，未独立记录逐笔币种；不计算跨币种总额。')
        if request.plan_tickers:
            selected['plans'] = [{k: v for k, v in row.items() if k in ('ticker', 'targetWeight', 'takeProfitPct', 'stopLossPct')} for row in state.get('positions', []) if row['ticker'] in request.plan_tickers]
        trades = {row['id']: row for row in state.get('trades', [])}
        if any(value not in trades for value in request.trade_ids):
            fail('trade_not_found', 422)
        selected['trade_reasons'] = [{'id': value, 'ticker': trades[value]['ticker'], 'date': trades[value]['date'], 'note': trades[value]['note']} for value in dict.fromkeys(request.trade_ids)]
    with store.connect() as db:
        if request.note_ids:
            selected['notes'] = []
            for note_id in dict.fromkeys(request.note_ids):
                row = db.execute('select id,body,updated_at from ai_journal_notes where id=? and deleted_at is null', (note_id,)).fetchone()
                if not row:
                    fail('note_not_found', 422)
                selected['notes'].append(dict(row))
        if request.history_turn_ids:
            selected['history'] = []
            for turn_id in dict.fromkeys(request.history_turn_ids):
                row = db.execute("select id,snapshot_id,answer from ai_journal_turns where id=? and status='completed'", (turn_id,)).fetchone()
                if not row:
                    fail('history_not_found', 422)
                snapshot, _, _ = store.snapshot(row['snapshot_id'])
                selected['history'].append({'id': turn_id, 'question': snapshot['request']['question'], 'answer': row['answer']})
    if sum(len(str(value)) for value in selected.values()) > 60000:
        fail('context_too_large', 422)
    return selected, missing
