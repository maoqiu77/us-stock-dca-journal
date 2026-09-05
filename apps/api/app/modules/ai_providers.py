"""Public provider presets and protocol-specific message conversion.

Endpoints/models checked against official documentation on 2026-09-05.
These are ordinary API endpoints, not Coding Plan subscriptions.
"""
from __future__ import annotations

from typing import Any


PROTOCOLS = ("auto", "chat/completions", "responses", "messages")


def preset(id: str, label: str, url: str, protocol: str, models: list[str], key_url: str = "", text_only: tuple[str, ...] = ()) -> dict[str, Any]:
    return {
        "id": id, "label": label, "baseUrl": url, "protocol": protocol,
        "complexModel": models[0], "simpleModel": models[0],
        "models": models, "keyUrl": key_url, "textOnlyModels": list(text_only),
        "protocols": list(PROTOCOLS) if id == "custom" else (["chat/completions", "responses"] if id in {"openai", "deepseek", "kimi"} else [protocol]),
    }


PROVIDERS = [
    preset("custom", "第三方 API（自定义）", "", "auto", ["gpt-5.6-luna"]),
    preset("deepseek", "DeepSeek 官方", "https://api.deepseek.com/v1", "chat/completions",
           ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-v4-flash-vision-exp"],
           "https://platform.deepseek.com/api_keys", ("deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner")),
    preset("kimi", "Kimi 官方（月之暗面）", "https://api.moonshot.cn/v1", "chat/completions",
           ["kimi-k3", "kimi-k2.6"], "https://platform.kimi.com/console/api-keys"),
    preset("glm", "GLM 官方（智谱）", "https://open.bigmodel.cn/api/paas/v4", "chat/completions",
           ["glm-4.7"], "https://bigmodel.cn/usercenter/proj-mgmt/apikeys", ("glm-4.7",)),
    preset("openai", "OpenAI 官方", "https://api.openai.com/v1", "responses",
           ["gpt-5.4-mini"], "https://platform.openai.com/api-keys"),
    preset("anthropic", "Claude 官方（Anthropic）", "https://api.anthropic.com/v1", "messages",
           ["claude-sonnet-5", "claude-haiku-4-5-20251001"], "https://platform.claude.com/settings/keys"),
    preset("qwen", "通义千问（阿里云百炼）", "https://dashscope.aliyuncs.com/compatible-mode/v1", "chat/completions",
           ["qwen-plus"], "https://bailian.console.aliyun.com/", ("qwen-plus",)),
    preset("minimax", "MiniMax 官方", "https://api.minimaxi.com/v1", "chat/completions",
           ["MiniMax-M2.7"], "https://platform.minimaxi.com/", ("MiniMax-M2.7",)),
    preset("siliconflow", "硅基流动", "https://api.siliconflow.cn/v1", "chat/completions",
           ["Qwen/Qwen3-8B"], "https://cloud.siliconflow.cn/account/ak"),
]
PROVIDER_BY_ID = {provider["id"]: provider for provider in PROVIDERS}


def build_anthropic_payload(model: str, messages: list[dict[str, Any]], max_output_tokens: int | None = None) -> dict[str, Any]:
    system: list[str] = []
    converted: list[dict[str, Any]] = []
    for message in messages:
        content = message.get("content", "")
        if message.get("role") == "system":
            if isinstance(content, str) and content.strip():
                system.append(content)
            continue
        if isinstance(content, list):
            blocks = []
            for item in content:
                if item.get("type") == "text":
                    blocks.append({"type": "text", "text": item.get("text", "")})
                elif item.get("type") == "image_url":
                    image = item.get("image_url", {})
                    url = image.get("url", "") if isinstance(image, dict) else str(image)
                    if url.startswith("data:"):
                        metadata, data = url.split(",", 1)
                        if ";base64" not in metadata:
                            raise ValueError("图片需要使用 base64 格式。")
                        source = {"type": "base64", "media_type": metadata[5:].split(";")[0], "data": data}
                    else:
                        source = {"type": "url", "url": url}
                    blocks.append({"type": "image", "source": source})
            content = blocks
        if content:
            converted.append({"role": "assistant" if message.get("role") == "assistant" else "user", "content": content})
    payload = {"model": model, "max_tokens": max_output_tokens or 8192, "messages": converted}
    if system:
        payload["system"] = "\n\n".join(system)
    return payload
