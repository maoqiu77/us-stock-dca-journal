from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Awaitable, Callable
from pydantic import BaseModel, ValidationError
from ..store import encoded
from .contracts import Evidence, ToolEvent

MAX_MODEL_INPUT_BYTES = 32000
MAX_RESERVED_UNITS = 145000


class LimitReached(Exception):
    """A local execution bound rejected work before it was sent upstream."""

    def __init__(self, reason='budget_exhausted', **details):
        self.reason = reason
        self.details = details
        super().__init__(reason)


class AccessRevoked(Exception):
    pass


class ModelOutcomeUnknown(Exception):
    pass


@dataclass
class Budget:
    deadline: float = field(default_factory=lambda: time.monotonic() + 90)
    model_calls: int = 0
    tool_calls: int = 0
    external_tools: int = 0
    reserved_units: int = 0
    max_model_calls: int = 4
    max_tool_calls: int = 8
    max_external_tools: int = 3
    max_output_tokens: int = 3072
    max_input_bytes: int = MAX_MODEL_INPUT_BYTES
    max_reserved_units: int = MAX_RESERVED_UNITS
    input_tokens: int = 0
    output_tokens: int = 0
    usage_complete: bool = True
    in_flight: bool = False
    provider_usage: list = field(default_factory=list)
    limit_reason: str | None = None
    limit_details: dict = field(default_factory=dict)
    answer_review: str = 'not_requested'
    report_validation_errors: list = field(default_factory=list)

    def remaining(self):
        return max(0.0, self.deadline - time.monotonic())

    def model(self, byte_count):
        if self.remaining() < .1:
            self.limit_reason, self.limit_details = 'deadline', {'remaining_seconds': self.remaining()}
            raise LimitReached(self.limit_reason, **self.limit_details)
        if self.model_calls >= self.max_model_calls:
            self.limit_reason, self.limit_details = 'model_calls', {'max_model_calls': self.max_model_calls}
            raise LimitReached(self.limit_reason, **self.limit_details)
        reserve = byte_count + self.max_output_tokens + 512
        if byte_count > self.max_input_bytes:
            self.limit_reason, self.limit_details = 'model_input_bytes', {
                'attempted_input_bytes': byte_count, 'max_input_bytes': self.max_input_bytes}
            raise LimitReached(self.limit_reason, **self.limit_details)
        if self.reserved_units + reserve > self.max_reserved_units:
            self.limit_reason, self.limit_details = 'reserved_units', {
                'attempted_reserved_units': self.reserved_units + reserve,
                'max_reserved_units': self.max_reserved_units}
            raise LimitReached(self.limit_reason, **self.limit_details)
        self.model_calls += 1
        self.reserved_units += reserve
        self.limit_reason, self.limit_details = None, {}

    def tool(self, external):
        if self.remaining() < .1:
            self.limit_reason, self.limit_details = 'deadline', {'remaining_seconds': self.remaining()}
            raise LimitReached(self.limit_reason, **self.limit_details)
        if self.tool_calls >= self.max_tool_calls:
            self.limit_reason, self.limit_details = 'tool_calls', {'max_tool_calls': self.max_tool_calls}
            raise LimitReached(self.limit_reason, **self.limit_details)
        self.tool_calls += 1
        if external:
            if self.external_tools >= self.max_external_tools:
                self.limit_reason, self.limit_details = 'external_tools', {
                    'max_external_tools': self.max_external_tools}
                raise LimitReached(self.limit_reason, **self.limit_details)
            self.external_tools += 1
        self.limit_reason, self.limit_details = None, {}

    def usage(self):
        return {'llm_calls': self.model_calls, 'tool_calls': self.tool_calls,
                'answer_review': self.answer_review,
                'report_validation_errors': self.report_validation_errors,
                'max_output_tokens_per_request': self.max_output_tokens,
                'external_tools': self.external_tools, 'reserved_units': self.reserved_units,
                'input_tokens': self.input_tokens if self.usage_complete and not self.in_flight else None,
                'output_tokens': self.output_tokens if self.usage_complete and not self.in_flight else None,
                'reported_input_tokens': self.input_tokens, 'reported_output_tokens': self.output_tokens,
                'provider_usage': self.provider_usage,
                'usage_complete': self.usage_complete and not self.in_flight,
                'model_request_in_flight': self.in_flight,
                'limit_reason': self.limit_reason,
                'limit_details': self.limit_details}


@dataclass
class ToolResult:
    sources: list[Evidence]
    view: dict


@dataclass
class ToolSpec:
    name: str
    description: str
    schema: type[BaseModel]
    run: Callable[[BaseModel], Awaitable[ToolResult]]
    external: bool = False
    authorize: Callable[[BaseModel], None] = lambda _: None

    def wire(self):
        return {'type': 'function', 'function': {'name': self.name, 'description': self.description,
                'parameters': self.schema.model_json_schema()}}


class ToolExecutor:
    def __init__(self, specs, book, budget, check_access, progress=lambda: None):
        self.specs = {spec.name: spec for spec in specs}
        self.book, self.budget = book, budget
        self.check_access, self.progress = check_access, progress
        self.cache, self.events = {}, []

    async def invoke(self, call):
        start = time.monotonic()
        name = call.get('name')
        visible = name if name in self.specs else 'unknown'
        status, count = 'failed', 0
        self.check_access()
        try:
            spec = self.specs.get(name)
            if spec is None:
                self.budget.tool(False)
                raise ValueError('tool_not_allowed')
            try:
                args = spec.schema.model_validate(call.get('args'))
            except ValidationError:
                self.budget.tool(False)
                raise ValueError('invalid_tool_arguments') from None
            key = name + ':' + encoded(args.model_dump(mode='json'))
            self.budget.tool(spec.external and key not in self.cache)
            spec.authorize(args)
            if key in self.cache:
                self.check_access()
                output, count = self.cache[key]
                try:
                    payload = json.loads(output)
                    sources = payload.get('sources', [])
                    cached = encoded({
                        'ok': True,
                        'data': {'already_observed': True,
                                 'source_ids': [row['id'] for row in sources if isinstance(row, dict) and row.get('id')]},
                        'sources': sources,
                    })
                except (TypeError, ValueError):
                    cached = encoded({'ok': True, 'data': {'already_observed': True}, 'sources': []})
                status = 'cached'
                return cached
            async with asyncio.timeout(min(15.0, self.budget.remaining())):
                result = await spec.run(args)
            self.check_access()
            output = encoded({'ok': True, 'data': result.view, 'sources': [
                {'id': row.id, 'kind': row.kind, 'as_of': row.as_of.isoformat(), 'hash': row.content_hash}
                for row in result.sources]})
            if len(output.encode()) > 14000:
                raise ValueError('tool_result_too_large')
            self.book.add_batch(result.sources, datetime.now(timezone.utc))
            count = len(result.sources)
            status = 'cached' if result.sources and (result.view.get('new_source_count') == 0 or result.view.get('already_observed')) else 'succeeded'
            self.cache[key] = output, count
            return output
        except (LimitReached, ValueError, TimeoutError) as exc:
            code = 'budget_exhausted' if isinstance(exc, LimitReached) else 'tool_timeout' if isinstance(exc, TimeoutError) else 'tool_unavailable_or_invalid'
            return encoded({'ok': False, 'error': code})
        finally:
            self.events.append(ToolEvent(tool=visible, status=status,
                duration_ms=int((time.monotonic() - start) * 1000), source_count=count).model_dump())
            self.progress()
