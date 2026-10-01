from __future__ import annotations

from decimal import Decimal
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class PreviewRequest(StrictModel):
    task_type: Literal['portfolio_review', 'instrument_research', 'conversation']
    question: str = Field(min_length=1, max_length=4000)
    instrument_key: Optional[str] = Field(default=None, max_length=100)
    primary_period: Optional[Literal['1d', '60m', '30m', '15m', '5m', '1m']] = None
    auxiliary_periods: list[str] = Field(default_factory=list, max_length=5)
    quantity: Optional[Decimal] = Field(default=None, ge=0, le=1e12, allow_inf_nan=False)
    cost: Optional[Decimal] = Field(default=None, ge=0, le=1e12, allow_inf_nan=False)
    max_position: Optional[Decimal] = Field(default=None, ge=0, le=1e12, allow_inf_nan=False)
    cost_currency: Optional[Literal['USD', 'CNY']] = None
    position_tickers: list[str] = Field(default_factory=list, max_length=30)
    plan_tickers: list[str] = Field(default_factory=list, max_length=30)
    trade_ids: list[str] = Field(default_factory=list, max_length=20)
    note_ids: list[str] = Field(default_factory=list, max_length=10)
    history_turn_ids: list[str] = Field(default_factory=list, max_length=10)
    session_id: Optional[str] = None
    reuse_snapshot_id: Optional[str] = None
    engine: Literal['llm', 'agent'] = 'llm'
    agent_version: Literal[1] = 1
    market_policy: Literal['frozen', 'refresh_within_scope'] = 'frozen'
    memory_mode: Literal['selected', 'suggest_related'] = 'selected'
    memory_excluded_ids: list[str] = Field(default_factory=list, max_length=100)
    auto_context: bool = False
    memory_before: Optional[datetime] = None

    @model_validator(mode='after')
    def validate_scope(self):
        if self.reuse_snapshot_id and self.market_policy != 'frozen':
            raise ValueError('历史行情快照只能冻结复用')
        if self.memory_before and self.memory_before.tzinfo is None:
            raise ValueError('记忆截止时间需要时区')
        if self.engine == 'llm' and not self.auto_context and (self.market_policy != 'frozen' or self.memory_mode != 'selected' or self.memory_excluded_ids):
            raise ValueError('Agent 选项仅用于 Agent 预览')
        if self.task_type != 'conversation' and (self.task_type == 'instrument_research') != bool(self.instrument_key):
            raise ValueError('标的快研需明确身份；持仓分析不接收单一标的')
        if len(set(self.auxiliary_periods)) != len(self.auxiliary_periods) or self.primary_period in self.auxiliary_periods:
            raise ValueError('主辅周期不可重复')
        if self.auxiliary_periods and not self.primary_period:
            raise ValueError('辅助周期需要主周期')
        if self.task_type == 'portfolio_review' and (self.primary_period or any(v is not None for v in (self.quantity, self.cost, self.max_position, self.cost_currency))):
            raise ValueError('组合分析不接收单标的周期或假设参数')
        if self.cost is not None and self.cost_currency is None:
            raise ValueError('成本需要币种')
        return self


class ConfirmRequest(StrictModel):
    snapshot_id: str = Field(min_length=1, max_length=100)
    digest: str = Field(min_length=64, max_length=64)
    idempotency_key: str = Field(min_length=8, max_length=100)


class AgentCapabilityTestRequest(StrictModel):
    confirmed: Literal[True]
    endpoint: Literal['chat/completions', 'responses']


class NoteRequest(StrictModel):
    body: str = Field(min_length=1, max_length=12000)


class DeleteNoteRequest(StrictModel):
    confirmed: Literal[True]


class QuantLinkRequest(StrictModel):
    run_id: str = Field(min_length=1, max_length=100)
    session_id: str = Field(min_length=1, max_length=100)
