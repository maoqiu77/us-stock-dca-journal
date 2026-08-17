from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictStr


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
    apiKey: Optional[StrictStr] = None
    clearApiKey: Optional[StrictBool] = None


class AiSettingsTestRequest(BaseModel):
    baseUrl: Optional[StrictStr] = None
    model: Optional[StrictStr] = None
    apiKey: Optional[StrictStr] = None


class UpdateStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    localStorageSnapshot: dict[StrictStr, StrictStr] = Field(default_factory=dict)
