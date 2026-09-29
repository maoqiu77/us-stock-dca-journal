from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Segment(str, Enum):
    US = "us"
    ETF = "etf"
    FUND = "fund"


class Market(str, Enum):
    US = "US"
    CN = "CN"


class AssetType(str, Enum):
    STOCK = "STOCK"
    ETF = "ETF"
    FUND = "FUND"


class ObservationStatus(str, Enum):
    AVAILABLE = "available"
    PARTIAL = "partial"
    STALE = "stale"
    MISSING = "missing"
    SAMPLE = "sample"


class ObservationMeta(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: str
    as_of: Optional[datetime] = None
    fetched_at: datetime
    status: ObservationStatus = ObservationStatus.AVAILABLE
    timeliness: str = "unknown"
    cache_state: str = "miss"
    reason: Optional[str] = None

    @field_validator("fetched_at")
    @classmethod
    def fetched_not_future(cls, value: datetime) -> datetime:
        now = datetime.now(timezone.utc)
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        if value > now.replace(microsecond=0) + timedelta(seconds=60):
            raise ValueError("fetched_at cannot be in the future")
        return value


class Instrument(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str
    symbol: str
    name: str
    market: Market
    exchange: str
    asset_type: AssetType
    currency: str
    timezone: str
    provider_symbols: dict[str, str] = Field(default_factory=dict)
    verified_at: Optional[datetime] = None

    @model_validator(mode="after")
    def check_identity(self) -> "Instrument":
        expected = f"{self.market.value}:{self.exchange}:{self.symbol}:{self.asset_type.value}"
        if self.key != expected:
            raise ValueError("instrument key does not match identity")
        if self.market is Market.US and self.currency != "USD":
            raise ValueError("US instruments must use USD")
        if self.market is Market.CN and self.currency != "CNY":
            raise ValueError("CN instruments must use CNY")
        if self.asset_type is AssetType.FUND and self.exchange != "FUND":
            raise ValueError("fund exchange must be FUND")
        if self.asset_type is AssetType.FUND and self.market is not Market.CN:
            raise ValueError("funds must be CN instruments")
        if self.market is Market.CN and self.exchange not in {"XSHG", "XSHE", "FUND"}:
            raise ValueError("unsupported CN exchange")
        if self.market is Market.US and self.exchange not in {"XNAS", "XNYS", "ARCX", "BATS"}:
            raise ValueError("unsupported US exchange")
        return self


def _decimal(value: Any, *, allow_none: bool = True) -> Optional[Decimal]:
    if value is None and allow_none:
        return None
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("invalid decimal") from exc
    if not result.is_finite():
        raise ValueError("decimal must be finite")
    return result


class Quote(BaseModel):
    model_config = ConfigDict(extra="forbid")
    instrument_key: str
    price: Optional[Decimal] = None
    previous_close: Optional[Decimal] = None
    change: Optional[Decimal] = None
    change_pct: Optional[Decimal] = None
    volume: Optional[Decimal] = None
    volume_unit: Optional[str] = None
    trading_date: Optional[date] = None
    session: str = "unknown"
    meta: ObservationMeta

    @field_validator("price", "previous_close", "change", "change_pct", "volume", mode="before")
    @classmethod
    def finite_decimal(cls, value: Any) -> Optional[Decimal]:
        return _decimal(value)

    @field_validator("volume")
    @classmethod
    def nonnegative_volume(cls, value: Optional[Decimal]) -> Optional[Decimal]:
        if value is not None and value < 0:
            raise ValueError("volume cannot be negative")
        return value


class Bar(BaseModel):
    model_config = ConfigDict(extra="forbid")
    time: datetime
    trading_date: Optional[date] = None
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Optional[Decimal] = None
    is_final: bool = True

    @field_validator("open", "high", "low", "close", "volume", mode="before")
    @classmethod
    def finite_bar_decimal(cls, value: Any) -> Optional[Decimal]:
        return _decimal(value, allow_none=True)

    @model_validator(mode="after")
    def valid_ohlc(self) -> "Bar":
        if self.high < max(self.open, self.close) or self.low > min(self.open, self.close) or self.low > self.high:
            raise ValueError("invalid OHLC")
        if self.volume is not None and self.volume < 0:
            raise ValueError("volume cannot be negative")
        return self


class Series(BaseModel):
    model_config = ConfigDict(extra="forbid")
    instrument_key: str
    currency: str
    period: str
    range: str
    timezone: str
    adjustment: str = "raw"
    volume_unit: Optional[str] = None
    time_label: str = "exchange"
    bars: list[Bar] = Field(default_factory=list)
    meta: ObservationMeta

    @model_validator(mode="after")
    def unique_ascending(self) -> "Series":
        stamps = [bar.time.isoformat() for bar in self.bars]
        if len(stamps) != len(set(stamps)) or stamps != sorted(stamps):
            raise ValueError("bars must be unique and ascending")
        return self


class Nav(BaseModel):
    model_config = ConfigDict(extra="forbid")
    value: Optional[Decimal] = None
    change_pct: Optional[Decimal] = None
    nav_date: Optional[date] = None
    announcement_date: Optional[date] = None
    meta: ObservationMeta


class PurchaseLimit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    state: str
    amount: Optional[Decimal] = None
    currency: str = "CNY"
    channel: Optional[str] = None
    meta: ObservationMeta

    @model_validator(mode="after")
    def amount_semantics(self) -> "PurchaseLimit":
        if self.state != "limited" and self.amount is not None:
            raise ValueError("only limited purchase state may have amount")
        if self.state == "limited" and (self.amount is None or self.amount <= 0):
            raise ValueError("limited purchase state needs positive amount")
        return self


class EtfMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")
    premium_pct: Optional[Decimal] = None
    premium_basis: str = "unknown"
    reference_value: Optional[Decimal] = None
    reference_date: Optional[date] = None
    percentile60: Optional[Decimal] = None
    sample_days: int = 0
    shares: Optional[Decimal] = None
    shares_date: Optional[date] = None
    shares_change: Optional[Decimal] = None
    previous_shares_date: Optional[date] = None
    meta: ObservationMeta


class FundHoldings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    instrument_key: str
    report_date: Optional[date] = None
    allocation: Optional[dict[str, Any]] = None
    stocks: list[dict[str, Any]] = Field(default_factory=list)
    meta: ObservationMeta


class BoardRow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    instrument: Instrument
    quote: Optional[Quote] = None
    nav: Optional[Nav] = None
    purchase_limit: Optional[PurchaseLimit] = None
    metrics: Optional[EtfMetrics] = None
    quality: ObservationStatus = ObservationStatus.MISSING


class Selection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    segment: Segment
    revision: int
    items: list[Instrument]


class BoardResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    segment: Segment
    rows: list[BoardRow]
    benchmarks: list[dict[str, Any]] = Field(default_factory=list)
    revision: int
    fetched_at: datetime
    warnings: list[str] = Field(default_factory=list)


class DetailResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    row: BoardRow
    holdings: Optional[FundHoldings] = None


class Capabilities(BaseModel):
    model_config = ConfigDict(extra="forbid")
    instrument_key: str
    quote: bool = True
    nav: bool = False
    periods: list[str] = Field(default_factory=list)
    ranges: list[str] = Field(default_factory=list)
