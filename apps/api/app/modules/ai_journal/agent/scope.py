from __future__ import annotations

from datetime import datetime
from ..context import usable
from ..store import digest, fail, encoded
from .contracts import make_evidence


def build_scope(board, request, private, facts, stamp, *, extra_keys=()):
    """Server-resolved selections grant access; question text grants nothing."""
    excluded = set(request.memory_excluded_ids)
    for field in ('notes', 'trade_reasons'):
        if field in private:
            private[field] = [row for row in private[field] if row['id'] not in excluded]
    keys = {row['instrument_key'] for row in private.get('positions', [])}
    keys.update(extra_keys)
    if request.instrument_key:
        keys.add(request.instrument_key)
    instruments = {key: board.catalog.resolve(key) for key in sorted(keys)}
    if any(item is None for item in instruments.values()):
        fail('agent_scope_unavailable', 422)
    periods = {key: ['1d'] if item.market.value == 'US' else [] for key, item in instruments.items()}
    sources = []

    def add(kind, entity, payload, as_of=stamp, revision=None):
        row = make_evidence(kind, entity, revision or digest(payload), payload, as_of, stamp)
        sources.append(row)

    for row in private.get('positions', []):
        add('position', 'position:' + row['instrument_key'], row)
    for row in private.get('plans', []):
        add('policy', 'policy:' + row['ticker'], row)
    for row in private.get('notes', []):
        updated = datetime.fromisoformat(row['updated_at'].replace('Z', '+00:00'))
        add('note', 'note:' + row['id'], row, updated, row['updated_at'] + ':' + digest(row['body']))
    for row in private.get('trade_reasons', []):
        if row.get('note', '').strip():
            # Trade date does not prove a historical version timestamp.
            add('trade_reason', 'trade:' + row['id'], row)
    memory = [row for row in sources if row.kind in {'note', 'trade_reason'}]
    if len(memory) > 24 or sum(len(encoded(row.payload).encode()) for row in memory) > 48000:
        fail('agent_memory_scope_too_large', 422)
    for fact in facts:
        key, value = fact['instrument_key'], fact['value']
        if key not in instruments or not usable(value):
            continue
        meta = value.get('meta') or {}
        observation = meta.get('as_of') or value.get('nav_date') or value.get('report_date') or value.get('reference_date') or value.get('shares_date')
        try:
            observed = datetime.fromisoformat(observation.replace('Z', '+00:00'))
        except (ValueError, TypeError):
            continue
        if observed.tzinfo is None or observed > stamp:
            continue
        kind = 'news' if fact['kind'] == '新闻' else 'series' if fact['kind'] == '已收盘 K 线' else 'quote'
        if kind == 'series':
            from app.modules.market_board.models import Series
            series = Series.model_validate(value)
            if series.instrument_key != key or series.period not in periods[key] or not series.bars or any(not bar.is_final for bar in series.bars):
                fail('agent_series_invalid', 422)
        # Preserve NAV/disclosure semantics instead of treating them as live prices.
        add(kind, kind + ':' + key + ':' + fact['kind'], {**value, 'instrument_key': key, 'fact_kind': fact['kind']}, observed)
    memory_filter_policy = [
        '已删除的手记不进入本轮检索，原文不可恢复',
        '当前快照时间之后的手记版本不进入本轮检索',
    ]
    if request.memory_excluded_ids:
        memory_filter_policy.append('本轮明确排除的手记不作为可读取原文返回')
    if request.memory_before:
        memory_filter_policy.append('历史检索只保留版本时间不晚于截止时间的手记；截止时间之后的版本不作为历史原文返回；无版本时间的交易理由不纳入')
    return {
        'version': 1, 'positions': bool(private.get('positions')), 'plans': bool(private.get('plans')),
        'memory': bool(memory), 'memory_source_ids': [row.id for row in memory],
        'memory_filter_policy': memory_filter_policy,
        'instrument_keys': sorted(instruments), 'periods_by_key': periods,
        'refresh_market': request.market_policy == 'refresh_within_scope',
        'coverage': 'workspace_verified_positions' if request.auto_context else 'selected_positions_only',
    }, [row.model_dump(mode='json') for row in sources]
