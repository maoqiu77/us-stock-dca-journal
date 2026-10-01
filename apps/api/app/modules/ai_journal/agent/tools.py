from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional
from pydantic import Field, model_validator
from app.modules.market_board.models import Series
from ..models import StrictModel
from ..context import usable
from .contracts import make_evidence
from .analytics import technicals, portfolio_exposure
from .runtime import ToolSpec, ToolResult
from .memory import memory_view


class Empty(StrictModel):
    pass


class MemoryQuery(StrictModel):
    query: str = Field(min_length=1, max_length=200)
    before: Optional[datetime] = None
    after: Optional[datetime] = None

    @model_validator(mode='after')
    def dates(self):
        if any(value and value.tzinfo is None for value in (self.before, self.after)) or (self.before and self.after and self.after > self.before):
            raise ValueError('memory_time_invalid')
        return self


class MarketQuery(StrictModel):
    instrument_key: str = Field(min_length=1, max_length=100)


class SeriesQuery(MarketQuery):
    period: Literal['1d']


class IndicatorQuery(StrictModel):
    series_source_id: str = Field(min_length=1, max_length=100)


class ExposureQuery(StrictModel):
    position_source_ids: list[str] = Field(min_length=1, max_length=30,
        description='read_portfolio_snapshot 返回的持仓 source_id；不是 instrument_key、ticker 或实体 ID。')
    quote_source_ids: list[str] = Field(default_factory=list, max_length=30,
        description='get_market_facts 已返回的交易报价 source_id；禁止使用日线、指标、成本或臆造 ID。无报价时传空列表，市值和权重保持未知。')


def make_tools(*, book, scope, read_private, read_market, read_series, search_memory):
    def authorize(args):
        if args.instrument_key not in scope['instrument_keys']:
            raise ValueError('instrument_not_authorized')
        if isinstance(args, SeriesQuery) and args.period not in scope['periods_by_key'].get(args.instrument_key, []):
            raise ValueError('period_not_authorized')

    async def positions(_):
        rows = await read_private('positions')
        return ToolResult(rows, {'positions': [{**row.payload, 'source_id': row.id} for row in rows],
            'coverage': scope.get('coverage', 'selected_positions_only'), 'cash': None, 'cost_semantics': 'remaining_position_weighted_average_unit_cost'})

    async def policy(_):
        rows = await read_private('plans')
        return ToolResult(rows, {'plans': [{**row.payload, 'source_id': row.id} for row in rows],
            'ratio_fields': {'targetWeight':'ratio_0_to_1', 'takeProfitPct':'ratio_0_to_1', 'stopLossPct':'ratio_0_to_1'}})

    async def memory(args):
        rows = await search_memory(args.query, **{key: value for key, value in {'before': args.before, 'after': args.after}.items() if value is not None})
        if len(rows) > 6 or any(row.kind not in {'note', 'trade_reason'} or row.id not in scope['memory_source_ids'] for row in rows):
            raise ValueError('memory_scope_invalid')
        return ToolResult(rows, {'matches': [memory_view(row, args.query) for row in rows]})

    async def facts(args):
        authorize(args)
        rows = await read_market(args.instrument_key)
        if any(row.kind != 'quote' or row.payload.get('instrument_key') != args.instrument_key or not usable(row.payload) for row in rows):
            raise ValueError('market_identity_or_quality_invalid')
        return ToolResult(rows, {'status': 'available' if rows else 'unavailable', 'facts': [{**row.payload, 'source_id': row.id} for row in rows]})

    async def series(args):
        authorize(args)
        row = await read_series(args.instrument_key, args.period)
        payload = {key: value for key, value in row.payload.items() if key != 'fact_kind'}
        value = Series.model_validate(payload)
        if row.kind != 'series' or value.instrument_key != args.instrument_key or value.period != args.period or not usable(payload) or not value.bars or any(not bar.is_final or bar.time.tzinfo is None or bar.time > row.available_at for bar in value.bars):
            raise ValueError('series_not_evidence')
        return ToolResult([row], {'series_source_id': row.id, 'meta': payload['meta'], 'bar_count': len(value.bars), 'period': value.period, 'adjustment': value.adjustment})

    async def indicators(args):
        row = book.rows.get(args.series_source_id)
        if not row or row.kind != 'series' or row.payload.get('instrument_key') not in scope['instrument_keys']:
            raise ValueError('series_not_observed')
        result = technicals(row.payload)
        source = make_evidence('calculation', row.entity_id, 'technical-v1', result,
                               datetime.fromisoformat(result['as_of']), datetime.now(timezone.utc), parents=[row.id])
        return ToolResult([source], {'source_id': source.id, **result})

    async def exposure(args):
        ids = args.position_source_ids + args.quote_source_ids
        if len(set(ids)) != len(ids) or any(value not in book.rows for value in ids):
            raise ValueError('exposure_sources_not_observed')
        positions = [book.rows[value] for value in args.position_source_ids]
        quotes = [book.rows[value] for value in args.quote_source_ids]
        keys = {row.payload.get('instrument_key') for row in positions}
        if not keys.issubset(scope['instrument_keys']) or any(row.payload.get('instrument_key') not in keys or not usable(row.payload) for row in quotes):
            raise ValueError('exposure_scope_invalid')
        result = portfolio_exposure(positions, quotes)
        result['coverage'] = 'observed_position_sources_only'
        source = make_evidence('calculation', 'portfolio:exposure', 'exposure-v1', result,
            max(book.rows[value].as_of for value in ids), datetime.now(timezone.utc), parents=ids)
        return ToolResult([source], {'source_id': source.id, **result})

    async def unavailable(args):
        authorize(args)
        return ToolResult([], {'status': 'unavailable', 'instrument_key': args.instrument_key,
            'reason': '本轮尚无满足有界读取和来源规范的新闻/基本面适配器。'})

    specs = []
    if scope['positions']:
        specs.append(ToolSpec('read_portfolio_snapshot', '读取本轮已选持仓；现金未知保持未知。', Empty, positions))
        specs.append(ToolSpec('calculate_portfolio_exposure', '先 read_portfolio_snapshot；需要市值或权重时先 get_market_facts 读取交易报价，再用这些来源 ID 计算分币种市值、成本和集中度；不估算现金。', ExposureQuery, exposure))
    if scope['plans']:
        specs.append(ToolSpec('read_investment_policy', '读取本轮已选投资计划；目标不等于实际仓位。', Empty, policy))
    if scope['memory']:
        specs.append(ToolSpec('search_investment_memory', '仅检索本轮已确认的手记和交易理由原文。', MemoryQuery, memory))
    if scope['instrument_keys']:
        specs.extend([
            ToolSpec('get_market_facts', '读取冻结市场观察，保留来源、日期和字段口径。', MarketQuery, facts, authorize=authorize),
            ToolSpec('get_price_series', '读取获准日线的已收盘 K 线，返回来源 ID。', SeriesQuery, series, authorize=authorize),
            ToolSpec('calculate_indicators', '只用已经读取的 K 线来源计算 MA5/20/60 和20根观察区间。', IndicatorQuery, indicators),
            ToolSpec('get_news_and_fundamentals', '当前新闻/基本面工具只返回明确不可用状态，不进行网络读取。', MarketQuery, unavailable, authorize=authorize),
        ])
    return specs
