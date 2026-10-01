from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
import json
from typing import Any, Literal, Optional
from uuid import uuid4

from pydantic import Field, model_validator
from ..models import StrictModel
from ..store import digest


class Evidence(StrictModel):
    id: str
    kind: Literal['position', 'policy', 'note', 'trade_reason', 'quote', 'series', 'calculation']
    entity_id: str
    revision: str
    classification: Literal['user_original', 'observed', 'derived']
    as_of: datetime
    available_at: datetime
    payload: dict[str, Any]
    content_hash: str
    input_source_ids: list[str] = Field(default_factory=list)

    @model_validator(mode='after')
    def integrity(self):
        json.dumps(self.payload, allow_nan=False)
        if self.as_of.tzinfo is None or self.available_at.tzinfo is None:
            raise ValueError('timezone_required')
        if self.content_hash != digest(self.payload):
            raise ValueError('source_hash_mismatch')
        expected = 'derived' if self.kind == 'calculation' else 'observed' if self.kind in {'quote', 'series'} else 'user_original'
        if self.classification != expected:
            raise ValueError('source_classification_invalid')
        if (self.kind == 'calculation') != bool(self.input_source_ids):
            raise ValueError('calculation_inputs_invalid')
        return self


def make_evidence(kind, entity_id, revision, payload, as_of, available_at, *, parents=()):
    classification = 'derived' if kind == 'calculation' else 'observed' if kind in {'quote', 'series'} else 'user_original'
    return Evidence(id=uuid4().hex, kind=kind, entity_id=entity_id, revision=revision,
                    classification=classification, as_of=as_of, available_at=available_at,
                    payload=payload, content_hash=digest(payload), input_source_ids=list(parents))


class Cited(StrictModel):
    text: str = Field(min_length=1, max_length=600)
    source_ids: list[str] = Field(min_length=1, max_length=6)


class Report(StrictModel):
    summary: str = Field(min_length=1, max_length=1000)
    stance: Literal['observe', 'maintain', 'conditional_change', 'insufficient_data']
    facts: list[Cited] = Field(max_length=6)
    interpretations: list[Cited] = Field(max_length=6)
    risks: list[Cited] = Field(max_length=4)
    missing: list[str] = Field(max_length=10)
    next_questions: list[str] = Field(max_length=3)


def insufficient(reason):
    return Report(summary='本轮证据不足，暂时无法完成判断。', stance='insufficient_data',
                  facts=[], interpretations=[], risks=[], missing=[reason], next_questions=[])


@dataclass
class EvidenceBook:
    excluded: set[str] = field(default_factory=set)
    rows: dict[str, Evidence] = field(default_factory=dict)

    def add_batch(self, items, known_at):
        staged = dict(self.rows)
        for item in items:
            item = Evidence.model_validate(item.model_dump())
            if {item.id, item.entity_id, item.revision} & self.excluded:
                raise ValueError('source_excluded')
            if item.as_of > known_at or item.available_at > known_at:
                raise ValueError('source_from_future')
            if any(parent not in staged for parent in item.input_source_ids):
                raise ValueError('unknown_calculation_input')
            if item.id in staged and staged[item.id] != item:
                raise ValueError('source_conflict')
            staged[item.id] = item
        self.rows = staged

    def validate_report(self, raw):
        report = Report.model_validate_json(raw)
        ids = {sid for group in (report.facts, report.interpretations, report.risks) for row in group for sid in row.source_ids}
        if not ids.issubset(self.rows):
            raise ValueError('citation_not_observed')
        if report.stance != 'insufficient_data' and not ids:
            raise ValueError('ungrounded_stance')
        return report


RunStatus = Literal['queued', 'running', 'succeeded', 'failed', 'outcome_unknown', 'cancel_requested', 'cancelled']


class ToolEvent(StrictModel):
    tool: str = Field(pattern=r'^[a-z_]{1,80}$')
    status: Literal['succeeded', 'failed', 'cached']
    duration_ms: int = Field(ge=0)
    source_count: int = Field(ge=0)


class RunResponse(StrictModel):
    id: str
    turn_id: str
    snapshot_id: str
    engine_version: str
    model_fingerprint: str
    status: RunStatus
    cancel_requested: bool
    result: Optional[Report] = None
    usage: Optional[dict[str, Any]] = None
    error_code: str
    created_at: str
    updated_at: str
    events: list[ToolEvent] = Field(default_factory=list)
    source_count: int = 0
