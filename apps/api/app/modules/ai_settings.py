from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import requests
from fastapi import HTTPException

from app.core.database import get_state_payload, set_state_payload


APP_STATE_KEY = "ai_settings_v1"
BEIJING_TZ = ZoneInfo("Asia/Shanghai")
AI_SETTINGS_TEST_TIMEOUT_SECONDS = 20
OPENAI_COMPATIBLE_ENDPOINTS = ("responses", "chat/completions")
AI_REQUEST_HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "User-Agent": "StockLab/0.1 OpenAI-compatible client",
}

DEFAULT_AI_SETTINGS: dict[str, Any] = {
    "schemaVersion": 1,
    "baseUrl": "",
    "model": "",
    "apiKey": "",
    "updatedAt": "",
}


def load_ai_settings() -> dict[str, Any]:
    payload = get_state_payload(APP_STATE_KEY)
    if not payload:
        return DEFAULT_AI_SETTINGS.copy()
    try:
        return sanitize_ai_settings(json.loads(payload))
    except (json.JSONDecodeError, TypeError):
        return DEFAULT_AI_SETTINGS.copy()


def save_ai_settings(settings: dict[str, Any]) -> dict[str, Any]:
    sanitized = sanitize_ai_settings(settings)
    if not sanitized["updatedAt"]:
        sanitized["updatedAt"] = beijing_timestamp()
    set_state_payload(APP_STATE_KEY, json.dumps(sanitized, ensure_ascii=False))
    return sanitized


def get_ai_settings_public() -> dict[str, Any]:
    settings = load_ai_settings()
    return public_ai_settings(settings)


def update_ai_settings(payload: dict[str, Any]) -> dict[str, Any]:
    current = load_ai_settings()
    next_settings = {
        **current,
        "baseUrl": str(payload.get("baseUrl", current.get("baseUrl", ""))).strip(),
        "model": str(payload.get("model", current.get("model", ""))).strip(),
        "updatedAt": beijing_timestamp(),
    }
    if payload.get("clearApiKey"):
        next_settings["apiKey"] = ""
    elif "apiKey" in payload:
        api_key = str(payload.get("apiKey") or "").strip()
        if api_key:
            next_settings["apiKey"] = api_key
    return public_ai_settings(save_ai_settings(next_settings))


def test_ai_settings_connection(payload: dict[str, Any]) -> dict[str, Any]:
    current = load_ai_settings()
    base_url = str(payload.get("baseUrl") or current.get("baseUrl", "")).strip().rstrip("/")
    model = str(payload.get("model") or current.get("model", "")).strip()
    api_key = str(payload.get("apiKey") or current.get("apiKey", "")).strip()
    if not base_url or not model or not api_key:
        raise HTTPException(status_code=400, detail="请先提供 AI Base URL、模型和 API Key。")

    normalized_base_url, preferred_endpoint = normalize_openai_base_url(base_url)
    headers = build_ai_request_headers(api_key)
    models: list[str] = []
    model_matched: bool | None = None
    models_error = ""
    try:
        response = requests.get(
            f"{normalized_base_url}/models",
            headers=headers,
            timeout=AI_SETTINGS_TEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        payload_json = response.json()
        models = extract_model_ids(payload_json)
        model_matched = model in models if models else None
    except requests.exceptions.RequestException as exc:
        models_error = f"；/models 测试失败：{describe_ai_request_error(exc)}"
    except ValueError as exc:
        models_error = "；/models 测试返回的 JSON 格式无效。"

    try:
        completion = call_openai_compatible_completion(
            base_url=normalized_base_url,
            model=model,
            api_key=api_key,
            messages=[
                {
                    "role": "system",
                    "content": "你是测试助手。",
                },
                {
                    "role": "user",
                    "content": "请只回复 ok。",
                },
            ],
            timeout=AI_SETTINGS_TEST_TIMEOUT_SECONDS,
            preferred_endpoint=preferred_endpoint,
        )
    except OpenAICompatibleRequestError as exc:
        detail = f"AI 生成接口测试失败：{exc}"
        if models_error:
            detail += models_error
        raise HTTPException(
            status_code=502,
            detail=detail,
        ) from exc

    generation_endpoint = completion["endpoint"]
    endpoint_label = (
        "Responses API" if generation_endpoint == "responses" else "chat/completions API"
    )

    if model_matched is False:
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
        "model": model,
        "modelMatched": model_matched,
        "modelCount": len(models),
        "responsesOk": True,
        "generationEndpoint": generation_endpoint,
        "message": message,
    }


def public_ai_settings(settings: dict[str, Any]) -> dict[str, Any]:
    api_key = str(settings.get("apiKey", ""))
    return {
        "schemaVersion": 1,
        "baseUrl": str(settings.get("baseUrl", "")),
        "model": str(settings.get("model", "")),
        "hasApiKey": bool(api_key),
        "apiKeyMasked": mask_api_key(api_key),
        "updatedAt": str(settings.get("updatedAt", "")),
    }


def sanitize_ai_settings(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return DEFAULT_AI_SETTINGS.copy()
    return {
        "schemaVersion": 1,
        "baseUrl": str(value.get("baseUrl", "")).strip(),
        "model": str(value.get("model", "")).strip(),
        "apiKey": str(value.get("apiKey", "")).strip(),
        "updatedAt": str(value.get("updatedAt", "")).strip(),
    }


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


def build_ai_request_headers(api_key: str) -> dict[str, str]:
    return {
        **AI_REQUEST_HEADERS,
        "Authorization": f"Bearer {api_key}",
    }


def normalize_openai_base_url(base_url: str) -> tuple[str, str | None]:
    normalized = str(base_url).strip().rstrip("/")
    for endpoint in OPENAI_COMPATIBLE_ENDPOINTS:
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
) -> dict[str, str]:
    normalized_base_url, detected_endpoint = normalize_openai_base_url(base_url)
    endpoint_preference = preferred_endpoint or detected_endpoint
    errors: list[str] = []
    for endpoint in openai_compatible_endpoint_order(endpoint_preference):
        try:
            response = requests.post(
                f"{normalized_base_url}/{endpoint}",
                headers=build_ai_request_headers(api_key),
                json=build_openai_compatible_payload(endpoint, model, messages),
                timeout=timeout,
            )
            response.raise_for_status()
            payload = response.json()
            return {
                "content": extract_response_text(payload),
                "endpoint": endpoint,
            }
        except requests.exceptions.RequestException as exc:
            errors.append(f"{endpoint}: {describe_ai_request_error(exc)}")
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            errors.append(f"{endpoint}: {exc}")
    raise OpenAICompatibleRequestError("；".join(errors))


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
) -> dict[str, Any]:
    if endpoint == "chat/completions":
        return build_chat_completions_payload(model, messages)
    return build_responses_payload(model, messages)


def build_chat_completions_payload(
    model: str,
    messages: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
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


def build_responses_payload(model: str, messages: list[dict[str, Any]]) -> dict[str, Any]:
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
    payload: dict[str, Any] = {"model": model, "input": input_messages}
    if instructions:
        payload["instructions"] = instructions
    return payload


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
                converted.append({"type": "input_image", "image_url": str(url)})
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
