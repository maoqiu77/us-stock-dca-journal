from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo
from urllib.parse import urlsplit

import requests
from fastapi import HTTPException
from openai import OpenAI, OpenAIError

from app.core.database import get_state_payload, set_state_payload
from app.modules.ai_providers import PROVIDERS, PROVIDER_BY_ID, PROTOCOLS, build_anthropic_payload
from app.modules.privacy_policy import ensure_ai_inference_allowed


APP_STATE_KEY = "ai_settings_v1"
BEIJING_TZ = ZoneInfo("Asia/Shanghai")
AI_SETTINGS_TEST_TIMEOUT_SECONDS = 60
OPENAI_COMPATIBLE_ENDPOINTS = ("responses", "chat/completions")
RESPONSES_ONLY_MODELS = frozenset({"gpt-5.6-sol"})
AI_REQUEST_HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "User-Agent": "StockLab/0.1 OpenAI-compatible client",
}

DEFAULT_AI_SETTINGS: dict[str, Any] = {
    "schemaVersion": 3,
    "provider": "custom",
    "protocol": "auto",
    "baseUrl": "",
    "complexModel": "gpt-5.6-luna",
    "simpleModel": "gpt-5.6-luna",
    "apiKey": "",
    "updatedAt": "",
}


def load_ai_settings() -> dict[str, Any]:
    payload = get_state_payload(APP_STATE_KEY)
    if not payload:
        return sanitize_ai_settings({})
    try:
        return sanitize_ai_settings(json.loads(payload))
    except (json.JSONDecodeError, TypeError):
        return sanitize_ai_settings({})


def save_ai_settings(settings: dict[str, Any]) -> dict[str, Any]:
    sanitized = sanitize_ai_settings(settings)
    if not sanitized["updatedAt"]:
        sanitized["updatedAt"] = beijing_timestamp()
    set_state_payload(APP_STATE_KEY, json.dumps(sanitized, ensure_ascii=False))
    return sanitized


def get_ai_settings_public() -> dict[str, Any]:
    settings = load_ai_settings()
    return public_ai_settings(settings)


def resolve_ai_settings(payload: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    current = sanitize_ai_settings(current)
    provider = str(payload.get("provider") or current["provider"])
    if provider not in PROVIDER_BY_ID:
        raise HTTPException(status_code=400, detail="请选择有效的 AI 服务商。")
    profile = sanitize_profile(current["profiles"].get(provider, {}), provider)
    preset = PROVIDER_BY_ID[provider]
    base_url = str(payload.get("baseUrl", profile["baseUrl"])).strip().rstrip("/")
    if provider != "custom" and base_url != preset["baseUrl"]:
        raise HTTPException(status_code=400, detail="官方接口地址已自动配置；自定义地址请选择第三方 API。")
    if base_url:
        try:
            parsed = urlsplit(base_url)
            valid = parsed.scheme in {"https", "http"} and parsed.hostname and not (parsed.username or parsed.password or parsed.query or parsed.fragment)
            parsed.port  # Reject malformed/out-of-range ports as user input errors.
        except ValueError:
            valid = False
        if not valid:
            raise HTTPException(status_code=400, detail="请输入有效的接口地址，不要在地址中填写密钥。")
    # A saved key belongs to this exact service location, not merely its hostname.
    old_base = normalize_openai_base_url(profile["baseUrl"])[0]
    new_base = normalize_openai_base_url(base_url)[0]
    if new_base != old_base:
        profile["apiKey"] = ""
    protocol = str(payload.get("protocol") or profile["protocol"])
    if protocol not in preset["protocols"]:
        raise HTTPException(status_code=400, detail="请选择有效的接口协议。")
    profile.update({"baseUrl": base_url, "protocol": protocol})
    for field in ("complexModel", "simpleModel"):
        if field in payload or payload.get("model"):
            profile[field] = str(payload.get(field) or payload.get("model") or "").strip()
    if payload.get("clearApiKey"):
        profile["apiKey"] = ""
    elif str(payload.get("apiKey") or "").strip():
        profile["apiKey"] = str(payload["apiKey"]).strip()
    profiles = {**current["profiles"], provider: profile}
    return {**profile, "schemaVersion": 3, "provider": provider, "profiles": profiles}


def update_ai_settings(payload: dict[str, Any]) -> dict[str, Any]:
    settings = resolve_ai_settings(payload, load_ai_settings())
    settings["updatedAt"] = beijing_timestamp()
    return public_ai_settings(save_ai_settings(settings))


def test_ai_settings_connection(payload: dict[str, Any]) -> dict[str, Any]:
    current = resolve_ai_settings(payload, load_ai_settings())
    base_url = current["baseUrl"]
    api_key = current["apiKey"]
    provider = current["provider"]
    protocol = current["protocol"]
    has_tiered_payload = "complexModel" in payload or "simpleModel" in payload or "provider" in payload
    complex_model = current["complexModel"]
    simple_model = current["simpleModel"]
    models_to_test = (
        [("complex", complex_model), ("simple", simple_model)]
        if has_tiered_payload
        else [("complex", complex_model)]
    )
    if not base_url or not api_key or any(not model for _, model in models_to_test):
        raise HTTPException(
            status_code=400,
            detail="请先提供 AI Base URL、复杂任务模型、简单任务模型和 API Key。",
        )

    normalized_base_url, preferred_endpoint = normalize_openai_base_url(base_url)
    headers = build_ai_request_headers(api_key, "messages" if protocol == "messages" or preferred_endpoint == "messages" else protocol)
    models: list[str] = []
    models_error = ""
    try:
        response = requests.get(
            f"{normalized_base_url}/models",
            headers=headers,
            timeout=AI_SETTINGS_TEST_TIMEOUT_SECONDS,
            allow_redirects=False,
        )
        response.raise_for_status()
        payload_json = response.json()
        models = extract_model_ids(payload_json)
    except requests.exceptions.RequestException as exc:
        models_error = f"；/models 测试失败：{describe_ai_request_error(exc)}"
    except ValueError as exc:
        models_error = "；/models 测试返回的 JSON 格式无效。"
    models_error = models_error.replace(api_key, "[密钥已隐藏]")

    model_results: dict[str, dict[str, Any]] = {}
    for tier, model in models_to_test:
        model_matched = model in models if models else None
        try:
            completion = call_openai_compatible_completion(
                base_url=normalized_base_url,
                model=model,
                api_key=api_key,
                messages=[
                    {"role": "system", "content": "你是测试助手。"},
                    {"role": "user", "content": "请只回复 ok。"},
                ],
                timeout=AI_SETTINGS_TEST_TIMEOUT_SECONDS,
                preferred_endpoint=preferred_endpoint,
                provider=provider,
                protocol=protocol,
                _connection_probe=True,
            )
        except OpenAICompatibleRequestError as exc:
            tier_label = "复杂任务模型" if tier == "complex" else "简单任务模型"
            detail = f"AI 生成接口测试失败（{tier_label}）：{exc}"
            if models_error:
                detail += models_error
            raise HTTPException(status_code=502, detail=detail) from exc
        model_results[tier] = {
            "model": model,
            "modelMatched": model_matched,
            "generationEndpoint": completion["endpoint"],
            "ok": True,
        }

    primary = model_results["complex"]
    generation_endpoint = str(primary["generationEndpoint"])
    endpoint_label = {"responses": "Responses API", "chat/completions": "chat/completions API", "messages": "Claude Messages API"}[generation_endpoint]
    model_matched = primary["modelMatched"]
    if has_tiered_payload:
        message = "连接成功，复杂任务模型和简单任务模型均可用。"
    elif model_matched is False:
        message = f"连接成功，{endpoint_label} 可用，但 /models 返回列表中没有当前模型。"
    elif model_matched is True:
        message = f"连接成功，当前模型存在，{endpoint_label} 可用。"
    else:
        message = f"连接成功，{endpoint_label} 可用，但无法从 /models 返回中读取模型列表。"
    if models_error:
        message = f"{message} {models_error.lstrip('；')}"
    return {
        "ok": True,
        "baseUrl": normalized_base_url,
        "model": complex_model,
        "complexModel": complex_model,
        "simpleModel": simple_model,
        "modelMatched": model_matched,
        "modelCount": len(models),
        "responsesOk": generation_endpoint == "responses",
        "generationOk": True,
        "models": models,
        "generationEndpoint": generation_endpoint,
        "modelResults": model_results,
        "message": message,
    }


def public_profile(profile: dict[str, Any]) -> dict[str, Any]:
    return {
        **{field: profile[field] for field in ("baseUrl", "protocol", "complexModel", "simpleModel", "updatedAt")},
        "hasApiKey": bool(profile["apiKey"]), "apiKeyMasked": mask_api_key(profile["apiKey"]),
    }


def public_ai_settings(settings: dict[str, Any]) -> dict[str, Any]:
    settings = sanitize_ai_settings(settings)
    return {
        **public_profile(settings), "schemaVersion": 3, "provider": settings["provider"],
        "model": settings["complexModel"],
        "profiles": {key: public_profile(value) for key, value in settings["profiles"].items()},
        "providers": PROVIDERS,
    }


def sanitize_profile(value: Any, provider: str) -> dict[str, Any]:
    value = value if isinstance(value, dict) else {}
    preset = PROVIDER_BY_ID[provider]
    return {
        "baseUrl": str(value.get("baseUrl", preset["baseUrl"])).strip().rstrip("/"),
        "protocol": value.get("protocol") if value.get("protocol") in PROTOCOLS else preset["protocol"],
        "complexModel": str(value.get("complexModel") or value.get("model") or preset["complexModel"]).strip(),
        "simpleModel": str(value.get("simpleModel") or value.get("model") or preset["simpleModel"]).strip(),
        "apiKey": str(value.get("apiKey") or "").strip(),
        "updatedAt": str(value.get("updatedAt") or "").strip(),
    }


def sanitize_ai_settings(value: Any) -> dict[str, Any]:
    value = value if isinstance(value, dict) else {}
    provider = value.get("provider", "custom")
    if provider not in PROVIDER_BY_ID:
        provider = "custom"
    raw_profiles = value.get("profiles")
    profiles = {key: sanitize_profile(profile, key) for key, profile in raw_profiles.items() if key in PROVIDER_BY_ID} if isinstance(raw_profiles, dict) else {}
    # The flattened active profile remains the interface used by existing AI consumers.
    profiles[provider] = sanitize_profile(value, provider)
    return {**profiles[provider], "schemaVersion": 3, "provider": provider, "profiles": profiles}


def mask_api_key(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "****"
    return f"{value[:4]}...{value[-4:]}"


def beijing_timestamp() -> str:
    return datetime.now(tz=BEIJING_TZ).strftime("%Y-%m-%d %H:%M")


def extract_model_ids(payload: Any) -> list[str]:
    if not isinstance(payload, dict):
        return []
    data = payload.get("data")
    if not isinstance(data, list):
        return []
    ids = []
    for item in data:
        if isinstance(item, dict):
            model_id = str(item.get("id", "")).strip()
            if model_id:
                ids.append(model_id)
    return ids


def extract_response_text(payload: Any) -> str:
    if isinstance(payload, dict):
        output_text = payload.get("output_text")
        if isinstance(output_text, str) and output_text.strip():
            return output_text.strip()
        output = payload.get("output")
        if isinstance(output, list):
            parts: list[str] = []
            for item in output:
                if not isinstance(item, dict):
                    continue
                content = item.get("content")
                if not isinstance(content, list):
                    continue
                for content_item in content:
                    if isinstance(content_item, dict):
                        text = content_item.get("text")
                        if isinstance(text, str) and text.strip():
                            parts.append(text.strip())
                if parts:
                    return "\n".join(parts).strip()
        choices = payload.get("choices")
        if isinstance(choices, list):
            parts = []
            for item in choices:
                if not isinstance(item, dict):
                    continue
                message = item.get("message")
                if isinstance(message, dict):
                    text = extract_text_value(message.get("content"))
                    if text:
                        return text
                text = extract_text_value(item.get("text"))
                if text:
                    parts.append(text)
                delta = item.get("delta")
                if isinstance(delta, dict):
                    delta_text = extract_text_value(delta.get("content"))
                    if delta_text:
                        parts.append(delta_text)
            if parts:
                return "\n".join(parts).strip()
    raise ValueError("Missing responses text")


def build_ai_request_headers(api_key: str, protocol: str = "auto") -> dict[str, str]:
    if protocol == "messages":
        return {**AI_REQUEST_HEADERS, "x-api-key": api_key, "anthropic-version": "2023-06-01"}
    return {
        **AI_REQUEST_HEADERS,
        "Authorization": f"Bearer {api_key}",
    }


def normalize_openai_base_url(base_url: str) -> tuple[str, str | None]:
    normalized = str(base_url).strip().rstrip("/")
    for endpoint in (*OPENAI_COMPATIBLE_ENDPOINTS, "messages"):
        suffix = f"/{endpoint}"
        if normalized.endswith(suffix):
            return normalized[: -len(suffix)].rstrip("/"), endpoint
    return normalized, None


def call_openai_compatible_completion(
    *,
    base_url: str,
    model: str,
    api_key: str,
    messages: list[dict[str, Any]],
    timeout: int,
    preferred_endpoint: str | None = None,
    provider: str = "custom",
    protocol: str = "auto",
    max_output_tokens: int | None = None,
    _connection_probe: bool = False,
) -> dict[str, str]:
    _check_completion_policy(messages, _connection_probe)
    normalized_base_url, detected_endpoint = normalize_openai_base_url(base_url)
    endpoint_preference = preferred_endpoint or detected_endpoint
    if protocol not in PROTOCOLS:
        raise OpenAICompatibleRequestError("未知的接口协议。")
    has_images = any(isinstance(message.get("content"), list) and any(item.get("type") == "image_url" for item in message["content"] if isinstance(item, dict)) for message in messages)
    if has_images and model in PROVIDER_BY_ID.get(provider, {}).get("textOnlyModels", []):
        raise OpenAICompatibleRequestError("当前模型不支持图片，请在高级设置中将简单任务模型切换为支持图片的模型。")
    if requires_responses_api(model) and protocol in {"auto", "responses"}:
        return call_responses_completion_with_sdk(
            base_url=normalized_base_url, model=model, api_key=api_key,
            messages=messages, timeout=timeout, max_output_tokens=max_output_tokens,
            _connection_probe=_connection_probe,
        )
    endpoints = [protocol] if protocol != "auto" else (["messages"] if endpoint_preference == "messages" else openai_compatible_endpoint_order(endpoint_preference))
    errors: list[str] = []
    for endpoint in endpoints:
        _check_completion_policy(messages, _connection_probe)
        try:
            if endpoint == "messages":
                body = build_anthropic_payload(model, messages, max_output_tokens)
            else:
                body = build_openai_compatible_payload(endpoint, model, messages, max_output_tokens=max_output_tokens)
                if endpoint == "chat/completions" and "max_completion_tokens" in body and (provider not in {"openai", "custom"} or not model.lower().startswith(("gpt-", "o1", "o3", "o4"))):
                    body["max_tokens"] = body.pop("max_completion_tokens")
            response = requests.post(
                f"{normalized_base_url}/{endpoint}", headers=build_ai_request_headers(api_key, endpoint),
                json=body, timeout=timeout, allow_redirects=False,
            )
            response.raise_for_status()
            payload = response.json()
            if endpoint == "messages":
                content = extract_text_value([block for block in payload.get("content", []) if isinstance(block, dict) and block.get("type") == "text"])
                if not content:
                    raise ValueError("模型未返回正文，请增加输出上限或更换模型。")
            else:
                content = extract_response_text(payload)
            return {"content": content, "endpoint": endpoint}
        except requests.exceptions.RequestException as exc:
            errors.append(f"{endpoint}: {describe_ai_request_error(exc)}")
            response = getattr(exc, "response", None)
            status = getattr(response, "status_code", None)
            provider_error = extract_provider_error_message(response).lower()
            unsupported = status in {404, 405, 501} and not any(word in provider_error for word in ("model", "模型", "quota", "余额", "key"))
            if not unsupported:
                break
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            errors.append(f"{endpoint}: {exc}")
            break
    detail = "；".join(errors)
    if api_key:
        detail = detail.replace(api_key, "[密钥已隐藏]")
    raise OpenAICompatibleRequestError(detail)


def call_responses_completion_with_sdk(
    *,
    base_url: str,
    model: str,
    api_key: str,
    messages: list[dict[str, Any]],
    timeout: int,
    max_output_tokens: int | None = None,
    _connection_probe: bool = False,
) -> dict[str, str]:
    _check_completion_policy(messages, _connection_probe)
    client: OpenAI | None = None
    try:
        client = OpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=timeout,
            max_retries=0,
        )
        response = client.responses.create(
            **build_responses_payload(
                model, messages, max_output_tokens=max_output_tokens
            ),
        )
        content = str(response.output_text or "").strip()
        if not content:
            raise ValueError("Missing responses text")
        return {
            "content": content,
            "endpoint": "responses",
        }
    except OpenAIError as exc:
        raise OpenAICompatibleRequestError(
            f"responses: {describe_openai_sdk_error(exc).replace(api_key, '[密钥已隐藏]') if api_key else describe_openai_sdk_error(exc)}"
        ) from exc
    except (AttributeError, KeyError, IndexError, TypeError, ValueError) as exc:
        raise OpenAICompatibleRequestError(f"responses: {exc}") from exc
    finally:
        if client is not None:
            client.close()


def _check_completion_policy(messages: list[dict[str, Any]], connection_probe: bool) -> None:
    # Only the explicit settings test may bypass inference policy, and only
    # for this exact fixed payload. No caller-controlled/private probe text.
    if connection_probe and messages == [
        {"role": "system", "content": "你是测试助手。"},
        {"role": "user", "content": "请只回复 ok。"},
    ]:
        return
    ensure_ai_inference_allowed()


def openai_compatible_endpoint_order(preferred_endpoint: str | None = None) -> list[str]:
    order: list[str] = []
    if preferred_endpoint in OPENAI_COMPATIBLE_ENDPOINTS:
        order.append(preferred_endpoint)
    for endpoint in OPENAI_COMPATIBLE_ENDPOINTS:
        if endpoint not in order:
            order.append(endpoint)
    return order


def build_openai_compatible_payload(
    endpoint: str,
    model: str,
    messages: list[dict[str, Any]],
    *,
    max_output_tokens: int | None = None,
) -> dict[str, Any]:
    if endpoint == "chat/completions":
        return build_chat_completions_payload(
            model, messages, max_output_tokens=max_output_tokens
        )
    return build_responses_payload(
        model, messages, max_output_tokens=max_output_tokens
    )


def build_chat_completions_payload(
    model: str,
    messages: list[dict[str, Any]],
    *,
    max_output_tokens: int | None = None,
) -> dict[str, Any]:
    payload = {
        "model": model,
        "messages": [
            {
                "role": normalize_chat_message_role(str(message.get("role", "user"))),
                "content": message.get("content", ""),
            }
            for message in messages
            if has_message_content(message.get("content"))
        ],
    }
    if max_output_tokens is not None:
        payload["max_completion_tokens"] = max(1, int(max_output_tokens))
    return payload


def build_responses_payload(
    model: str,
    messages: list[dict[str, Any]],
    *,
    max_output_tokens: int | None = None,
) -> dict[str, Any]:
    instructions = "\n\n".join(
        str(message.get("content", "")).strip()
        for message in messages
        if message.get("role") == "system" and str(message.get("content", "")).strip()
    )
    input_messages = [
        {
            "role": normalize_response_input_role(str(message.get("role", "user"))),
            "content": to_responses_content(message.get("content", "")),
        }
        for message in messages
        if message.get("role") != "system" and has_message_content(message.get("content"))
    ]
    payload: dict[str, Any] = {
        "model": model,
        "input": input_messages,
        "store": False,
    }
    if instructions:
        payload["instructions"] = instructions
    if max_output_tokens is not None:
        payload["max_output_tokens"] = max(1, int(max_output_tokens))
    if requires_responses_api(model):
        payload["reasoning"] = {"effort": "low"}
    return payload


def requires_responses_api(model: str) -> bool:
    return str(model).strip().lower() in RESPONSES_ONLY_MODELS


def has_message_content(content: Any) -> bool:
    return bool(content) if isinstance(content, list) else bool(str(content).strip())


def to_responses_content(content: Any) -> Any:
    if not isinstance(content, list):
        return str(content)
    converted: list[dict[str, Any]] = []
    for item in content:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "text":
            converted.append({"type": "input_text", "text": str(item.get("text", ""))})
        elif item.get("type") == "image_url":
            image_url = item.get("image_url")
            url = image_url.get("url") if isinstance(image_url, dict) else image_url
            if url:
                converted_image = {
                    "type": "input_image",
                    "image_url": str(url),
                }
                detail = image_url.get("detail") if isinstance(image_url, dict) else None
                if detail in {"auto", "low", "high"}:
                    converted_image["detail"] = detail
                converted.append(converted_image)
    return converted


def normalize_chat_message_role(role: str) -> str:
    if role in {"system", "assistant", "user"}:
        return role
    return "user"


def normalize_response_input_role(role: str) -> str:
    return "assistant" if role == "assistant" else "user"


def extract_text_value(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str) and text.strip():
                    parts.append(text.strip())
        return "\n".join(parts).strip()
    if isinstance(value, dict):
        text = value.get("text")
        if isinstance(text, str) and text.strip():
            return text.strip()
    return ""


class OpenAICompatibleRequestError(ValueError):
    pass


def describe_ai_request_error(exc: requests.exceptions.RequestException) -> str:
    response = getattr(exc, "response", None)
    provider_message = extract_provider_error_message(response)
    if provider_message:
        return f"{exc}；服务返回：{provider_message}"
    return str(exc)


def describe_openai_sdk_error(exc: OpenAIError) -> str:
    response = getattr(exc, "response", None)
    provider_message = extract_provider_error_message(response)
    message = str(exc).strip()
    if provider_message and provider_message not in message:
        return f"{message}；服务返回：{provider_message}"
    return message


def extract_provider_error_message(response: Any) -> str:
    if response is None:
        return ""
    try:
        payload = response.json()
    except ValueError:
        payload = None
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict):
            message = error.get("message")
            if isinstance(message, str) and message.strip():
                return message.strip()
        if isinstance(error, str) and error.strip():
            return error.strip()
    text = str(getattr(response, "text", "")).strip()
    return text[:500]
