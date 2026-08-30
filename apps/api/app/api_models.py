from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictStr, field_validator


class TradingStateRequest(BaseModel):
    model_config = ConfigDict(extra="allow")


class AiAdviceBriefRequest(BaseModel):
    brief: StrictStr = ""


class AiAdviceChatRequest(BaseModel):
    prompt: StrictStr


class PositionScreenshotRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    imageDataUrl: StrictStr
    mode: StrictStr = "auto"


class AiSettingsUpdateRequest(BaseModel):
    baseUrl: Optional[StrictStr] = None
    model: Optional[StrictStr] = None
    complexModel: Optional[StrictStr] = None
    simpleModel: Optional[StrictStr] = None
    apiKey: Optional[StrictStr] = None
    clearApiKey: Optional[StrictBool] = None


class AiSettingsTestRequest(BaseModel):
    baseUrl: Optional[StrictStr] = None
    model: Optional[StrictStr] = None
    complexModel: Optional[StrictStr] = None
    simpleModel: Optional[StrictStr] = None
    apiKey: Optional[StrictStr] = None


class UpdateStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    localStorageSnapshot: dict[StrictStr, StrictStr] = Field(default_factory=dict)


class QuantAnalysisMode(str, Enum):
    QUICK = "quick"
    DEEP = "deep"


class QuantAnalystType(str, Enum):
    TECHNICAL = "technical"
    FUNDAMENTALS = "fundamentals"
    NEWS = "news"
    SOCIAL = "social"
    MACRO = "macro"


class QuantAnalysisRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ticker: StrictStr
    analysisDate: StrictStr
    mode: QuantAnalysisMode
    analysts: list[QuantAnalystType] = Field(min_length=1)
    reflectionEnabled: StrictBool = False
    forceRegenerate: StrictBool = False

    @field_validator("ticker")
    @classmethod
    def validate_ticker(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not normalized or len(normalized) > 15:
            raise ValueError("标的代码长度必须在 1 到 15 个字符之间。")
        allowed = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-")
        if normalized[0] not in set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") or any(
            character not in allowed for character in normalized
        ):
            raise ValueError("标的代码仅支持字母、数字、点和连字符。")
        return normalized

    @field_validator("analysisDate")
    @classmethod
    def validate_analysis_date(cls, value: str) -> str:
        try:
            parsed = date.fromisoformat(value)
        except ValueError as exc:
            raise ValueError("分析日期必须使用 YYYY-MM-DD 格式。") from exc
        if parsed > date.today():
            raise ValueError("分析日期不能晚于今天。")
        return parsed.isoformat()

    @field_validator("analysts")
    @classmethod
    def validate_unique_analysts(
        cls, value: list[QuantAnalystType]
    ) -> list[QuantAnalystType]:
        if len(set(value)) != len(value):
            raise ValueError("分析师不能重复选择。")
        return value


class ResearchSettingsUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fredApiKey: Optional[StrictStr] = None
    clearFredApiKey: Optional[StrictBool] = None


class ResearchSettingsTestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fredApiKey: Optional[StrictStr] = None
