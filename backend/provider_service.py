from __future__ import annotations

import json
import os
from typing import Any, AsyncIterator

import httpx
from fastapi import HTTPException

from backend.attachments_service import build_attachment_context_from_records, extract_urls_from_messages, fetch_url_context, perform_web_search, resolve_attachment_records
from backend.config import OPENAI_VISION_MODELS, SUPABASE_ENABLED
from backend.models import ChatRequest


def supports_openai_vision(model: str) -> bool:
    return any(token in model for token in OPENAI_VISION_MODELS)


def append_multimodal_images(messages: list[dict[str, Any]], records: list[dict[str, Any]], is_openai: bool, model: str) -> list[dict[str, Any]]:
    if not is_openai or not supports_openai_vision(model):
        return messages
    image_urls = []
    for record in records:
        if not record["is_image"]:
            continue
        url = record["metadata"].get("url") or record["item"].url
        if url and str(url).startswith("http"):
            image_urls.append(str(url))
    if not image_urls:
        return messages
    updated = list(messages)
    last_user_index = next((i for i in range(len(updated) - 1, -1, -1) if updated[i].get("role") == "user"), None)
    if last_user_index is None:
        return updated
    original_content = updated[last_user_index].get("content")
    content_blocks = list(original_content) if isinstance(original_content, list) else [{"type": "text", "text": str(original_content or "")}]
    for url in image_urls:
        content_blocks.append({"type": "image_url", "image_url": {"url": url}})
    updated[last_user_index] = {**updated[last_user_index], "content": content_blocks}
    return updated


async def build_chat_request(payload: ChatRequest, user_id: str | None) -> tuple[str, str, dict[str, str], dict[str, Any], dict[str, Any]]:
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages cannot be empty")
    configured_model = payload.model or os.environ.get("CODE_PUPPY_CHAT_MODEL", "hf:zai-org/GLM-4.7")
    is_openai = configured_model.startswith("openai:")
    forwarded_model = configured_model
    if is_openai:
        api_key = os.environ.get("OPEN_API_KEY") or os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise HTTPException(status_code=503, detail="OPEN_API_KEY is not configured")
        forwarded_model = configured_model.replace("openai:", "", 1)
        base_url = os.environ.get("OPENAI_CHAT_URL", "https://api.openai.com/v1/chat/completions")
    else:
        api_key = os.environ.get("SYN_API_KEY")
        if not api_key:
            raise HTTPException(status_code=503, detail="SYN_API_KEY is not configured")
        base_url = os.environ.get("SYN_CHAT_URL", "https://api.synthetic.new/openai/v1/chat/completions")

    attachment_records = await resolve_attachment_records(payload.attachments, user_id, SUPABASE_ENABLED)
    has_image_attachments = any(record["is_image"] for record in attachment_records)
    if has_image_attachments and not (is_openai and supports_openai_vision(forwarded_model)):
        raise HTTPException(status_code=400, detail=f'Model "{configured_model}" does not support image attachments. Switch to a vision-capable OpenAI model.')

    chat_messages: list[dict[str, Any]] = []
    if payload.systemPrompt:
        chat_messages.append({"role": "system", "content": payload.systemPrompt})

    attachment_context = build_attachment_context_from_records(attachment_records)
    if attachment_context:
        chat_messages.append({"role": "system", "content": attachment_context})

    urls = extract_urls_from_messages(payload.messages)
    if urls:
        url_context = await fetch_url_context(urls)
        if url_context:
            chat_messages.append({"role": "system", "content": "Fetched URL context:\n\n" + url_context})

    search_debug: dict[str, Any] = {
        "enabled": bool(payload.webSearch),
        "provider": "duckduckgo",
        "used": False,
        "query": None,
        "resultCount": 0,
        "summary": "Web search disabled for this request.",
    }
    if payload.webSearch:
        last_user_message = next((m for m in reversed(payload.messages) if m.get("role") == "user" and isinstance(m.get("content"), str)), None)
        if last_user_message:
            search_result = await perform_web_search(str(last_user_message.get("content") or ""))
            search_debug = {
                "enabled": True,
                "provider": search_result.get("provider") or "duckduckgo",
                "used": bool(search_result.get("used")),
                "query": search_result.get("query"),
                "resultCount": int(search_result.get("resultCount") or 0),
                "summary": str(search_result.get("summary") or ""),
            }
            search_context = str(search_result.get("context") or "")
            if search_context:
                chat_messages.append({"role": "system", "content": search_context})
        else:
            search_debug = {
                "enabled": True,
                "provider": "duckduckgo",
                "used": False,
                "query": None,
                "resultCount": 0,
                "summary": "Web search was enabled, but no user message was available to search.",
            }

    for message in payload.messages:
        role = message.get("role")
        content = message.get("content")
        if role and content is not None:
            chat_messages.append({"role": role, "content": content})

    chat_messages = append_multimodal_images(chat_messages, attachment_records, is_openai, forwarded_model)
    request_body = {
        "model": forwarded_model,
        "messages": chat_messages,
        "temperature": payload.temperature if payload.temperature is not None else 0.2,
        "stream": False,
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    return base_url, forwarded_model, headers, request_body, search_debug


async def invoke_chat(payload: ChatRequest, user_id: str | None = None) -> dict[str, Any]:
    base_url, forwarded_model, headers, request_body, search_debug = await build_chat_request(payload, user_id)
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
        try:
            response = await client.post(base_url, headers=headers, json=request_body)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=exc.response.status_code, detail=exc.response.text or exc.response.reason_phrase) from exc
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
    data = response.json()
    choices = data.get("choices") or []
    message_text = choices[0].get("message", {}).get("content", "") if choices else ""
    return {"message": message_text, "raw": data, "usage": data.get("usage", {}), "model": forwarded_model, "search": search_debug}


async def stream_chat(payload: ChatRequest, user_id: str | None = None) -> AsyncIterator[dict[str, Any]]:
    base_url, forwarded_model, headers, request_body, search_debug = await build_chat_request(payload, user_id)
    request_body["stream"] = True
    full_text = ""
    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
        try:
            async with client.stream("POST", base_url, headers=headers, json=request_body) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    payload_line = line[5:].strip()
                    if payload_line == "[DONE]":
                        break
                    try:
                        chunk = json.loads(payload_line)
                    except json.JSONDecodeError:
                        continue
                    delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")
                    if delta:
                        full_text += delta
                        yield {"event": "delta", "content": delta}
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=exc.response.status_code, detail=exc.response.text or exc.response.reason_phrase) from exc
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
    yield {"event": "done", "content": full_text, "model": forwarded_model, "search": search_debug}
