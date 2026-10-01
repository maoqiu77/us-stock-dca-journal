from __future__ import annotations

import copy
import json

from .capabilities import ModelCapability
from .model import DEEPSEEK_ADAPTER_VERSION, adapter_version_for, endpoint_for, ready, output_limit_for


def wire_messages(messages):
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
    result, pending, seen = [], set(), set()
    for message in messages:
        if isinstance(message, ToolMessage):
            if message.tool_call_id not in pending or not isinstance(message.content, str):
                raise ValueError('model_tool_linkage_invalid')
            pending.remove(message.tool_call_id)
            row = {'role': 'tool', 'tool_call_id': message.tool_call_id, 'content': message.content}
        else:
            if pending or not isinstance(message.content, str):
                raise ValueError('model_tool_linkage_invalid')
            if isinstance(message, AIMessage):
                if message.invalid_tool_calls:
                    raise ValueError('model_protocol_invalid')
                # Provider fields live only in graph memory, never in the journal archive.
                row = copy.deepcopy(message.additional_kwargs.get('deepseek_message'))
                if row is None:
                    row = {'role': 'assistant', 'content': message.content}
                    if message.tool_calls:
                        row['tool_calls'] = [{'id': call['id'], 'type': 'function', 'function': {
                            'name': call['name'], 'arguments': json.dumps(call['args'], ensure_ascii=False)}}
                            for call in message.tool_calls]
                    for key, value in message.additional_kwargs.items():
                        if key.startswith('reasoning_'):
                            row[key] = copy.deepcopy(value)
                calls = row.get('tool_calls') or []
                ids = [call.get('id') for call in calls]
                if any(not value or value in seen for value in ids) or len(ids) != len(set(ids)):
                    raise ValueError('model_tool_linkage_invalid')
                pending.update(ids)
                seen.update(ids)
            elif isinstance(message, (SystemMessage, HumanMessage)):
                row = {'role': 'system' if isinstance(message, SystemMessage) else 'user', 'content': message.content}
            else:
                raise ValueError('model_message_unsupported')
        result.append(row)
    if pending:
        raise ValueError('model_tool_linkage_invalid')
    return result


def parse_reply(response):
    from langchain_core.messages import AIMessage
    if len(response.choices) != 1:
        raise ValueError('model_protocol_invalid')
    choice = response.choices[0]
    message = choice.message
    raw = message.model_dump(exclude_none=True)
    raw.update(copy.deepcopy(message.model_extra or {}))
    raw['content'] = message.content
    if message.content is not None and not isinstance(message.content, str):
        raise ValueError('model_protocol_invalid')
    calls, invalid = [], []
    for call in message.tool_calls or []:
        try:
            args = json.loads(call.function.arguments)
            if call.type != 'function' or not isinstance(args, dict):
                raise ValueError('model_protocol_invalid')
            calls.append({'id': call.id, 'name': call.function.name, 'args': args})
        except (ValueError, AttributeError):
            invalid.append({'id': call.id, 'name': getattr(call.function, 'name', ''),
                'args': getattr(call.function, 'arguments', ''), 'error': 'invalid_tool_arguments'})
    usage = None
    if response.usage:
        value = response.usage
        usage = {'input_tokens': value.prompt_tokens, 'output_tokens': value.completion_tokens,
                 'total_tokens': value.total_tokens}
        reasoning = getattr(value.completion_tokens_details, 'reasoning_tokens', None)
        cached = getattr(value, 'prompt_cache_hit_tokens', None)
        if reasoning is not None:
            usage['output_token_details'] = {'reasoning': reasoning}
        if cached is not None:
            usage['input_token_details'] = {'cache_read': cached}
    return AIMessage(content=message.content or '', tool_calls=calls, invalid_tool_calls=invalid,
        additional_kwargs={'deepseek_message': raw}, usage_metadata=usage,
        response_metadata={'finish_reason': choice.finish_reason, 'model_name': response.model})


def build_deepseek_agent_model(settings, capability, *, probing=False, client_factory=None):
    from openai import AsyncOpenAI
    from ..service import model_fingerprint
    capability = ModelCapability.model_validate(capability)
    base = endpoint_for(settings, capability.endpoint)
    if adapter_version_for(settings) != DEEPSEEK_ADAPTER_VERSION:
        raise ValueError('agent_provider_unsupported')
    if capability.adapter_version != DEEPSEEK_ADAPTER_VERSION or capability.model_fingerprint != model_fingerprint(settings) or (not probing and not ready(settings, capability)):
        raise ValueError('agent_model_unverified')
    factory = client_factory or AsyncOpenAI

    async def call(messages, tools):
        payload = {'model': settings.get('complexModel') or settings['model'],
                   'messages': wire_messages(messages), 'max_tokens': output_limit_for(settings), 'stream': False}
        if tools:
            payload['tools'] = tools
        async with factory(base_url=base, api_key=settings['apiKey'], max_retries=0, timeout=25) as client:
            response = await client.chat.completions.create(**payload)
        return parse_reply(response)
    return call
