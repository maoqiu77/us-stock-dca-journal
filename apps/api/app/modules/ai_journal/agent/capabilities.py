from __future__ import annotations

from typing import Literal, Optional
from pydantic import model_validator
from ..models import StrictModel


class ModelCapability(StrictModel):
    model_fingerprint: str
    endpoint: Literal['chat/completions', 'responses', 'messages', 'auto']
    adapter_version: str = 'phase-0'
    tool_calling: bool = False
    verified_at: Optional[str] = None
    verification: Literal['unverified', 'offline', 'real_provider'] = 'unverified'

    @model_validator(mode='after')
    def gate(self):
        if self.tool_calling and (self.verification != 'real_provider' or not self.verified_at or self.endpoint not in {'chat/completions', 'responses'}):
            raise ValueError('real_provider_verification_required')
        return self


def protocol_matrix():
    # Reading this matrix must never instantiate a provider or perform a probe.
    return [{'protocol': protocol, 'enabled': False, 'reason': 'not_verified'}
            for protocol in ('chat/completions', 'responses', 'messages', 'deepseek', 'auto')]
