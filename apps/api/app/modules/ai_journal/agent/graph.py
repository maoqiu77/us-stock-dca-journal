from __future__ import annotations

import asyncio
import json
import time
from contextlib import suppress
from typing import TypedDict
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage, messages_to_dict
from langgraph.graph import StateGraph, START, END
from ..store import encoded
from .contracts import insufficient
from .answer_quality import normalize_report, review_messages, answer_size
from pydantic import ValidationError
from .runtime import (AccessRevoked, LimitReached,
                      ModelOutcomeUnknown)


class State(TypedDict):
    messages: list
    result: dict | None
    repair_count: int
    stop_code: str
    review_requested: bool
    review_tool_rounds: int
    review_started: float
    style_repair_count: int


def compact_tool_messages(messages):
    """Bound repeated tool evidence while retaining the first full observation.

    Search results are allowed to overlap across model-selected queries. Keeping
    every repeated excerpt makes the next serialized request grow even though
    the evidence book already has the source. The compact marker retains the
    source ID and the original ToolMessage/call ID, so validation and access
    checks remain unchanged and the model can still cite an observed source.
    """
    seen_sources = set()
    seen_match_payloads = set()
    seen_outputs = set()
    compacted = []
    for message in messages:
        if not isinstance(message, ToolMessage) or not isinstance(message.content, str):
            compacted.append(message)
            continue
        try:
            payload = json.loads(message.content)
        except (TypeError, ValueError):
            compacted.append(message)
            continue
        if not isinstance(payload, dict) or payload.get('ok') is not True:
            compacted.append(message)
            continue
        original_key = encoded(payload)
        if original_key in seen_outputs:
            sources = payload.get('sources') if isinstance(payload.get('sources'), list) else []
            ids = [row.get('id') for row in sources if isinstance(row, dict) and row.get('id')]
            replacement = {'ok': True,
                           'data': {'already_observed': True, 'source_ids': ids},
                           'sources': [{'id': source_id, 'already_observed': True} for source_id in ids]}
            compacted.append(message.model_copy(update={'content': encoded(replacement)}))
            continue
        seen_outputs.add(original_key)
        before_sources = set(seen_sources)
        data = payload.get('data')
        if isinstance(data, dict) and isinstance(data.get('matches'), list):
            data = dict(data)
            matches = []
            for match in data['matches']:
                if not isinstance(match, dict):
                    matches.append(match)
                    continue
                source_id = match.get('source_id')
                match_key = encoded(match)
                # A query may reveal another excerpt from the same original.
                # Only identical views are redundant; source identity alone
                # does not prove that the model has seen this passage.
                duplicate = match_key in seen_match_payloads
                matches.append({'source_id': source_id, 'already_observed': True} if duplicate and source_id
                                else {'already_observed': True} if duplicate else match)
                seen_match_payloads.add(match_key)
                if source_id:
                    seen_sources.add(source_id)
            data['matches'] = matches
            payload = {**payload, 'data': data}
        sources = payload.get('sources')
        if isinstance(sources, list):
            source_rows = []
            for source in sources:
                if not isinstance(source, dict):
                    source_rows.append(source)
                    continue
                source_id = source.get('id')
                if source_id and source_id in before_sources:
                    source_rows.append({'id': source_id, 'already_observed': True})
                else:
                    source_rows.append(source)
                if source_id:
                    seen_sources.add(source_id)
            payload = {**payload, 'sources': source_rows}
        compacted.append(message.model_copy(update={'content': encoded(payload)}))
    return compacted


def model_input_bytes(messages, tools):
    return len(encoded({'messages': messages_to_dict(messages), 'tools': tools}).encode())


def build_graph(*, model_call, executor, book, budget, check_access, progress=lambda: None, research_plan=None):
    seen_calls = set()
    review_enabled = bool(research_plan and research_plan.get('version', 0) >= 2)

    async def llm(state):
        check_access()
        messages = compact_tool_messages(state['messages'])
        reserve = 2 if review_enabled and not state.get('review_requested') else 1
        final_only = (budget.model_calls >= budget.max_model_calls - reserve or budget.tool_calls >= budget.max_tool_calls
                      or budget.remaining() < (35 if reserve == 2 else 10) or state.get('review_tool_rounds', 0) >= 1)
        if state.get('review_requested') and budget.model_calls >= budget.max_model_calls - 2:
            # Keep a final slot for repairing the reviewed JSON/citations.
            final_only = True
        tools = [] if final_only else [spec.wire() for spec in executor.specs.values()]
        if not final_only and model_input_bytes(messages, tools) > budget.max_input_bytes:
            # A growing transcript is a local context condition. Finish from
            # already observed evidence before spending another tool turn.
            final_only = True
            tools = []
        if final_only:
            messages = messages + [HumanMessage(content='预算即将结束。仅用已读证据输出最终 JSON，缺失则明确列出。')]
        try:
            budget.model(model_input_bytes(messages, tools))
        except LimitReached:
            return {'result': insufficient('已达到运行上限。').model_dump(), 'stop_code':'budget_exhausted'}
        # Persist reservation before the request. Transport interruption cannot trigger replay.
        budget.in_flight = True
        progress()
        try:
            task = asyncio.create_task(model_call(messages, tools))
            try:
                async with asyncio.timeout(min(25.0, budget.remaining())):
                    while not task.done():
                        await asyncio.wait({task}, timeout=.25)
                        check_access()
                    reply = await task
            finally:
                if not task.done():
                    task.cancel()
                with suppress(asyncio.CancelledError, Exception):
                    await task
        except AccessRevoked:
            budget.usage_complete = False
            raise
        except Exception as exc:
            from openai import APIConnectionError, APITimeoutError
            import httpx
            budget.provider_usage.append(None)
            if isinstance(exc, (TimeoutError, APIConnectionError, APITimeoutError, httpx.TransportError)):
                budget.usage_complete = False
                progress()
                raise ModelOutcomeUnknown() from None
            budget.in_flight = False
            budget.usage_complete = False
            progress()
            raise ValueError('model_call_failed') from None
        budget.in_flight = False
        usage = reply.usage_metadata if isinstance(reply, AIMessage) else None
        if usage:
            budget.input_tokens += usage['input_tokens']; budget.output_tokens += usage['output_tokens']
        else:
            budget.usage_complete = False
        budget.provider_usage.append(dict(usage) if usage else None)
        progress()
        check_access()
        if not isinstance(reply, AIMessage) or reply.invalid_tool_calls:
            raise ValueError('model_protocol_invalid')
        if reply.response_metadata.get('finish_reason') == 'length' or reply.response_metadata.get('stop_reason') == 'max_tokens':
            from app.modules.ai_settings import IncompleteCompletionError
            raise IncompleteCompletionError('model_output_truncated')
        ids = [call.get('id') for call in reply.tool_calls]
        if len(ids) > 3 or any(not item or item in seen_calls for item in ids) or len(ids) != len(set(ids)) or (final_only and ids):
            raise ValueError('model_tool_ids_invalid')
        seen_calls.update(ids)
        return {'messages': messages + [reply]}

    async def tools(state):
        outputs = [ToolMessage(content=await executor.invoke(call), tool_call_id=call['id']) for call in state['messages'][-1].tool_calls]
        return {'messages':state['messages'] + outputs,
                'review_tool_rounds': state.get('review_tool_rounds', 0) + int(bool(state.get('review_requested')))}

    async def validate(state):
        check_access()
        try:
            report = normalize_report(book.validate_report(state['messages'][-1].text))
            no_claims = (report.stance == 'insufficient_data' and report.summary == insufficient('').summary
                         and not report.facts and not report.interpretations and not report.risks)
            if review_enabled and not state.get('review_requested') and no_claims:
                budget.answer_review = 'not_needed'
            elif review_enabled and not state.get('review_requested'):
                review_inputs = review_messages(state['messages'], report, book, research_plan)
                review_fits = model_input_bytes(review_inputs, []) <= budget.max_input_bytes - 512
                if budget.model_calls < budget.max_model_calls and budget.remaining() >= 10 and review_fits:
                    budget.answer_review = 'in_progress'
                    progress()
                    return {'review_requested': True, 'review_started': time.monotonic(),
                        'messages': review_inputs}
                budget.answer_review = 'skipped_budget' if review_fits else 'skipped_context'
            elif state.get('review_requested'):
                target = research_plan.get('answer_contract', {}).get('target_characters', 700)
                if (answer_size(report) > target * 1.2 and not state.get('style_repair_count')
                        and budget.model_calls < budget.max_model_calls and budget.remaining() >= 10):
                    compression_inputs = state['messages'] + [HumanMessage(content=f'内容已核对，但正文约{answer_size(report)}字，超过用户要求。现在仅做一次精简：总计控制在{target}字以内，结论一句，依据最多两条，行动条件各一句；核实消息或概念题不强行给交易行动。删除各部分重复内容，保留关键数字的日期与口径，不新增事实或工具调用。返回同一报告JSON并保留引用。')]
                    if model_input_bytes(compression_inputs, []) <= budget.max_input_bytes - 512:
                        return {'style_repair_count': 1, 'review_tool_rounds': 1,
                            'messages': compression_inputs}
                budget.answer_review = 'completed'
                executor.events.append({'tool': 'review_answer', 'status': 'succeeded', 'source_count': 0,
                    'duration_ms': int((time.monotonic() - state.get('review_started', time.monotonic())) * 1000)})
                progress()
            return {'result':report.model_dump(), 'stop_code':'completed'}
        except ValueError as exc:
            if isinstance(exc, ValidationError):
                details = [{'field': list(error['loc']), 'type': error['type']}
                    for error in exc.errors(include_input=False, include_context=False, include_url=False)[:8]]
            else:
                details = [{'type': 'citation_not_observed_or_ungrounded_stance'}]
            # Retain only schema locations and codes, never provider text or originals.
            budget.report_validation_errors.append({'call': budget.model_calls, 'errors': details})
            progress()
            if state['repair_count'] >= 1 or budget.model_calls >= budget.max_model_calls:
                return {'result':insufficient('回答未通过结构或引用校验。').model_dump(), 'stop_code':'validation_failed'}
            return {'repair_count':state['repair_count'] + 1, 'messages':state['messages'] + [HumanMessage(
                content='结构或引用校验失败。只使用已读取来源修复一次，返回规定 JSON，不补造依据。校验项：' + encoded(details))]}

    graph = StateGraph(State)
    graph.add_node('llm', llm); graph.add_node('tools', tools); graph.add_node('validate', validate)
    graph.add_edge(START, 'llm')
    graph.add_conditional_edges('llm', lambda state: END if state['result'] is not None else 'tools' if state['messages'][-1].tool_calls else 'validate', ['tools','validate',END])
    graph.add_edge('tools', 'llm')
    graph.add_conditional_edges('validate', lambda state: END if state['result'] is not None else 'llm', ['llm',END])
    return graph.compile()
