from __future__ import annotations

import importlib.util
import os
import sys
from datetime import datetime, timezone
from urllib.parse import urlsplit
from app.modules.ai_settings import normalize_openai_base_url
from .capabilities import ModelCapability

ADAPTER_VERSION = 'standard-openai-v1'
DEEPSEEK_ADAPTER_VERSION = 'deepseek-chat-v1'
STANDARD_MAX_OUTPUT_TOKENS = 3072
DEEPSEEK_MAX_OUTPUT_TOKENS = 6144


def adapter_version_for(settings):
    host = urlsplit(settings.get('baseUrl', '')).hostname or ''
    return DEEPSEEK_ADAPTER_VERSION if settings.get('provider') == 'deepseek' or host == 'api.deepseek.com' else ADAPTER_VERSION


def output_limit_for(settings):
    return DEEPSEEK_MAX_OUTPUT_TOKENS if adapter_version_for(settings) == DEEPSEEK_ADAPTER_VERSION else STANDARD_MAX_OUTPUT_TOKENS


def runtime_available():
    return sys.version_info >= (3, 12) and all(importlib.util.find_spec(name) for name in ('langgraph', 'langchain_core', 'langchain_openai'))


def execution_enabled():
    return os.environ.get('STOCK_APP_AI_JOURNAL_AGENT_ENABLED', '1').lower() in {'1', 'true', 'yes'}


def endpoint_for(settings, endpoint):
    base, detected = normalize_openai_base_url(settings.get('baseUrl', ''))
    deepseek = adapter_version_for(settings) == DEEPSEEK_ADAPTER_VERSION
    if settings.get('provider', 'custom') not in {'openai', 'custom', 'deepseek'}:
        raise ValueError('agent_provider_unsupported')
    if deepseek and endpoint != 'chat/completions':
        raise ValueError('agent_protocol_unsupported')
    if endpoint not in {'chat/completions', 'responses'}:
        raise ValueError('agent_protocol_unsupported')
    configured = settings.get('protocol', 'auto')
    if configured not in {'auto', endpoint} or (detected and detected != endpoint):
        raise ValueError('agent_protocol_mismatch')
    if not base or not settings.get('apiKey') or not (settings.get('complexModel') or settings.get('model')):
        raise ValueError('ai_not_configured')
    return base


def ready(settings, capability):
    from ..service import model_fingerprint
    try:
        capability = ModelCapability.model_validate(capability)
        endpoint_for(settings, capability.endpoint)
        return execution_enabled() and runtime_available() and capability.tool_calling and capability.verification == 'real_provider' and capability.adapter_version == adapter_version_for(settings) and capability.model_fingerprint == model_fingerprint(settings)
    except ValueError:
        return False


def build_openai_agent_model(settings, capability, *, client_factory=None, probing=False):
    from ..service import model_fingerprint
    capability = ModelCapability.model_validate(capability)
    if adapter_version_for(settings) != ADAPTER_VERSION:
        raise ValueError('agent_provider_unsupported')
    base = endpoint_for(settings, capability.endpoint)
    if capability.model_fingerprint != model_fingerprint(settings) or (not probing and not ready(settings, capability)):
        raise ValueError('agent_model_unverified')
    if client_factory is None:
        from langchain_openai import ChatOpenAI
        client_factory = ChatOpenAI
    model = client_factory(model=settings.get('complexModel') or settings['model'],
        base_url=base, api_key=settings['apiKey'], use_responses_api=capability.endpoint == 'responses',
        use_previous_response_id=False, max_retries=0, timeout=25, max_tokens=output_limit_for(settings),
        http_socket_options=(),
        **({'store': False} if capability.endpoint == 'responses' else {}))

    async def call(messages, tools):
        selected = model.bind_tools(tools) if tools else model
        return await selected.ainvoke(messages)
    return call


def build_agent_model(settings, capability, *, probing=False):
    if adapter_version_for(settings) == DEEPSEEK_ADAPTER_VERSION:
        from .deepseek import build_deepseek_agent_model
        return build_deepseek_agent_model(settings, capability, probing=probing)
    return build_openai_agent_model(settings, capability, probing=probing)


async def probe(settings, endpoint, check_access, model_factory=build_agent_model):
    """Explicit synthetic two-call test only. Never invoked from preview/loading."""
    import asyncio
    from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
    from ..service import model_fingerprint
    fingerprint = model_fingerprint(settings)
    candidate = ModelCapability(model_fingerprint=fingerprint, endpoint=endpoint, adapter_version=adapter_version_for(settings))
    call = model_factory(settings, candidate, probing=True)
    tools = [{'type': 'function', 'function': {'name': 'echo_capability', 'description': 'Echo a synthetic value.',
              'parameters': {'type':'object', 'properties':{'value':{'type':'string'}}, 'required':['value'], 'additionalProperties':False}}}]
    messages = [HumanMessage(content='Call echo_capability once with value synthetic-capability. After its result, reply exactly synthetic-capability. No other tools.')]
    check_access()
    async with asyncio.timeout(25):
        reply = await call(messages, tools)
    check_access()
    if not isinstance(reply, AIMessage) or reply.invalid_tool_calls or len(reply.tool_calls) != 1:
        raise ValueError('agent_probe_protocol_invalid')
    tool = reply.tool_calls[0]
    if not tool.get('id') or tool['name'] != 'echo_capability' or tool['args'] != {'value': 'synthetic-capability'}:
        raise ValueError('agent_probe_protocol_invalid')
    messages += [reply, ToolMessage(content='synthetic-capability', tool_call_id=tool['id'])]
    check_access()
    async with asyncio.timeout(25):
        final = await call(messages, [])
    check_access()
    if not isinstance(final, AIMessage) or final.invalid_tool_calls or final.tool_calls or final.text.strip() != 'synthetic-capability':
        raise ValueError('agent_probe_protocol_invalid')
    return candidate.model_copy(update={'verification':'real_provider', 'tool_calling':True, 'verified_at':datetime.now(timezone.utc).isoformat()})
