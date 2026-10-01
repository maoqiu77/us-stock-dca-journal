from __future__ import annotations

from decimal import Decimal
from datetime import datetime, timezone
from app.modules.market_board.models import Series


def technicals(payload):
    value = {key: item for key, item in payload.items() if key != 'fact_kind'}
    series = Series.model_validate(value)
    if series.meta.status.value not in {'available', 'partial', 'stale'} or not series.meta.as_of:
        raise ValueError('series_unusable')
    bars = [bar for bar in series.bars if bar.is_final]
    if not bars:
        raise ValueError('no_final_bars')
    times = [bar.time for bar in bars]
    if any(stamp.tzinfo is None for stamp in times) or times != sorted(set(times)) or times[-1] > datetime.now(timezone.utc):
        raise ValueError('bar_time_invalid')
    closes = [Decimal(str(bar.close)) for bar in bars]
    if any(not value.is_finite() or value <= 0 for value in closes):
        raise ValueError('close_invalid')
    return {
        'instrument_key': series.instrument_key, 'period': series.period, 'currency': series.currency,
        'adjustment': series.adjustment, 'status': series.meta.status.value,
        'as_of': bars[-1].time.isoformat(), 'bar_count': len(bars),
        'method': 'SMA-close-v1; last-20-final-bars-range-v1',
        **{f'ma{n}': str(sum(closes[-n:]) / n) if len(closes) >= n else None for n in (5, 20, 60)},
        'range20': None if len(bars) < 20 else {
            'low': str(min(bar.low for bar in bars[-20:])),
            'high': str(max(bar.high for bar in bars[-20:])),
            'from': bars[-20].time.isoformat(), 'through': bars[-1].time.isoformat(),
        },
        'missing': [f'MA{n}缺少足够的完整 K 线' for n in (5, 20, 60) if len(bars) < n],
    }


def portfolio_exposure(positions, quotes):
    by_key = {}
    for row in quotes:
        if row.kind != 'quote' or row.payload.get('fact_kind') != '交易报价':
            raise ValueError('exposure_requires_trading_quotes')
        key = row.payload['instrument_key']
        if key in by_key:
            raise ValueError('duplicate_valuation')
        by_key[key] = row
    groups = {}
    for row in positions:
        if row.kind != 'position':
            raise ValueError('exposure_requires_positions')
        payload = row.payload
        quantity, cost = Decimal(str(payload['quantity'])), Decimal(str(payload['cost']))
        if not quantity.is_finite() or not cost.is_finite() or quantity <= 0 or cost < 0:
            raise ValueError('position_value_invalid')
        key = payload['instrument_key']
        quote = by_key.get(key)
        if quote and quote.payload.get('price') is not None and quote.payload.get('currency') != payload['currency']:
            raise ValueError('valuation_currency_mismatch_or_unknown')
        price = Decimal(str(quote.payload['price'])) if quote and quote.payload.get('price') is not None else None
        if price is not None and (not price.is_finite() or price <= 0):
            raise ValueError('valuation_price_invalid')
        group = groups.setdefault(payload['currency'], {'currency': payload['currency'], 'positions': [], 'complete': True})
        group['complete'] &= price is not None
        group['positions'].append({'instrument_key': key, 'quantity': str(quantity),
            'holding_cost': str(quantity * cost), 'market_value': str(quantity * price) if price is not None else None,
            'position_source_id': row.id, 'quote_source_id': quote.id if quote else None,
            'quote_as_of': quote.as_of.isoformat() if quote else None,
            'quote_status': (quote.payload.get('meta') or {}).get('status') if quote else None})
    for group in groups.values():
        values = group['positions']
        total = sum(Decimal(row['market_value']) for row in values) if group['complete'] else None
        group['market_value'] = str(total) if total is not None else None
        group['holding_cost'] = str(sum(Decimal(row['holding_cost']) for row in values))
        for row in values:
            row['weight_within_currency'] = str(Decimal(row['market_value']) / total) if total else None
        group['largest_weight_within_currency'] = str(max(Decimal(row['weight_within_currency']) for row in values)) if total else None
    return {'method': 'quantity-times-trading-quote-v1; weights-within-currency-only',
        'groups': list(groups.values()), 'total_across_currencies': None,
        'cash': None, 'fees': None, 'external_accounts': None,
        'missing': ['现金、费用及外部账户未知；权重只覆盖本轮读取持仓，不是账户总仓位。'] +
            (['不同币种不合并，也不计算跨币种总权重。'] if len(groups) > 1 else []) +
            (['部分持仓缺少交易报价，所属币种的总市值和权重未知；正式净值未当作交易报价。'] if any(not group['complete'] for group in groups.values()) else [])}
