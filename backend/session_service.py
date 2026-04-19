from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import httpx
from fastapi import HTTPException

from backend.config import SESSION_DIR, SESSION_ID_PATTERN, SUPABASE_DB_ENABLED, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL


def session_file(session_id: str) -> Path:
    if not SESSION_ID_PATTERN.fullmatch(session_id):
        raise HTTPException(status_code=400, detail="Invalid session id")
    return SESSION_DIR / f"{session_id}.json"


def sanitize_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cleaned: list[dict[str, Any]] = []
    for item in (messages or [])[-200:]:
        role = item.get("role")
        content = item.get("content")
        if not role or content is None:
            continue
        cleaned.append({"role": str(role)[:32], "content": content})
    return cleaned


def derive_title(payload: dict[str, Any]) -> str:
    title = str(payload.get("title") or "").strip()
    if title:
        return title[:120]
    for message in payload.get("messages") or []:
        if message.get("role") == "user":
            content = message.get("content")
            if isinstance(content, str) and content.strip():
                return content.strip()[:120]
    return "New chat"


def snapshot_is_meaningful(payload: dict[str, Any]) -> bool:
    messages = payload.get("messages") or []
    if any(str(item.get("content") or "").strip() for item in messages if item.get("role") in {"user", "assistant"}):
        return True
    if str(payload.get("composer") or "").strip():
        return True
    attachments = payload.get("attachments") or []
    return bool(attachments)


async def supabase_db_request(
    method: str,
    path: str,
    *,
    params: dict[str, Any] | None = None,
    json_body: Any | None = None,
    prefer: str | None = None,
) -> Any:
    if not SUPABASE_DB_ENABLED:
        raise HTTPException(status_code=503, detail="Supabase DB is not configured")
    headers = {
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
        response = await client.request(
            method,
            f"{SUPABASE_URL}/rest/v1/{path.lstrip('/')}",
            headers=headers,
            params=params,
            json=json_body,
        )
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=response.text or response.reason_phrase)
    if not response.text:
        return None
    return response.json()


async def load_supabase_session(session_id: str, user_id: str) -> dict[str, Any]:
    rows = await supabase_db_request(
        "GET",
        "/chat_sessions",
        params={
            "session_id": f"eq.{session_id}",
            "user_id": f"eq.{user_id}",
            "select": "payload",
        },
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Session not found")
    payload = rows[0].get("payload") or {}
    if not isinstance(payload, dict):
        raise HTTPException(status_code=500, detail="Session payload is corrupted")
    return payload


async def save_supabase_session(session_id: str, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    if not snapshot_is_meaningful(payload):
        return {"status": "skipped", "updatedAt": payload.get("updatedAt") or time.time()}
    now = payload.get("updatedAt") or time.time()
    body = {
        "session_id": session_id,
        "user_id": user_id,
        "title": payload.get("title") or derive_title(payload),
        "updated_at": now,
        "message_count": len(payload.get("messages") or []),
        "payload": payload,
    }
    rows = await supabase_db_request(
        "POST",
        "/chat_sessions",
        params={"on_conflict": "user_id,session_id"},
        json_body=body,
        prefer="resolution=merge-duplicates,return=representation",
    )
    saved = rows[0] if rows else body
    return {"status": "saved", "updatedAt": saved.get("updated_at") or now}


async def list_supabase_sessions(limit: int, user_id: str, query: str = '') -> list[dict[str, Any]]:
    rows = await supabase_db_request(
        "GET",
        "/chat_sessions",
        params={
            "user_id": f"eq.{user_id}",
            "select": "session_id,title,updated_at,message_count,payload",
            "order": "updated_at.desc",
            "limit": str(limit),
        },
    )
    items: list[dict[str, Any]] = []
    normalized_query = query.strip().lower()
    for row in rows or []:
        payload = row.get("payload") or {}
        if not snapshot_is_meaningful(payload):
            continue
        if normalized_query:
            haystack = ' '.join(
                [
                    str(row.get('title') or ''),
                    str(row.get('session_id') or ''),
                    ' '.join(str(message.get('content') or '') for message in payload.get('messages') or []),
                ]
            ).lower()
            if normalized_query not in haystack:
                continue
        items.append(
            {
                "sessionId": row.get("session_id"),
                "title": row.get("title") or derive_title(payload),
                "updatedAt": row.get("updated_at") or time.time(),
                "messageCount": row.get("message_count") or len(payload.get("messages") or []),
            }
        )
    return items


async def delete_supabase_session(session_id: str, user_id: str) -> dict[str, Any]:
    await supabase_db_request(
        "DELETE",
        "/chat_sessions",
        params={"session_id": f"eq.{session_id}", "user_id": f"eq.{user_id}"},
        prefer="return=representation",
    )
    return {"status": "deleted", "sessionId": session_id}


async def cleanup_empty_supabase_sessions(user_id: str) -> dict[str, Any]:
    rows = await supabase_db_request(
        "GET",
        "/chat_sessions",
        params={
            "user_id": f"eq.{user_id}",
            "select": "session_id,payload",
            "limit": "500",
        },
    )
    removed = 0
    for row in rows or []:
        payload = row.get("payload") or {}
        session_id = row.get("session_id")
        if not session_id or snapshot_is_meaningful(payload):
            continue
        await supabase_db_request(
            "DELETE",
            "/chat_sessions",
            params={"session_id": f"eq.{session_id}", "user_id": f"eq.{user_id}"},
            prefer="return=representation",
        )
        removed += 1
    return {"status": "cleaned", "removed": removed}


def load_local_session(session_id: str) -> dict[str, Any]:
    path = session_file(session_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Session not found")
    try:
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="Session file is corrupted") from exc


def list_local_sessions(limit: int, query: str = '') -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    normalized_query = query.strip().lower()
    files = sorted(SESSION_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    for path in files[:limit]:
        try:
            with path.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (json.JSONDecodeError, OSError):
            continue
        if not snapshot_is_meaningful(data):
            continue
        if normalized_query:
            haystack = ' '.join(
                [
                    str(data.get('title') or ''),
                    str(data.get('sessionId') or path.stem),
                    ' '.join(str(message.get('content') or '') for message in data.get('messages') or []),
                ]
            ).lower()
            if normalized_query not in haystack:
                continue
        entries.append(
            {
                "sessionId": data.get("sessionId") or path.stem,
                "title": data.get("title") or derive_title(data),
                "updatedAt": data.get("updatedAt") or path.stat().st_mtime,
                "messageCount": len(data.get("messages") or []),
            }
        )
    return entries


def save_local_session(session_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    path = session_file(session_id)
    if not snapshot_is_meaningful(payload):
        if path.exists():
            path.unlink(missing_ok=True)
        return {"status": "skipped", "updatedAt": payload.get("updatedAt") or time.time()}
    tmp_path = path.with_suffix(".tmp")
    tmp_path.parent.mkdir(parents=True, exist_ok=True)
    with tmp_path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)
    tmp_path.replace(path)
    return {"status": "saved", "updatedAt": payload["updatedAt"]}


def delete_local_session(session_id: str) -> dict[str, Any]:
    path = session_file(session_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Session not found")
    try:
        path.unlink()
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to delete session: {exc}") from exc
    return {"status": "deleted", "sessionId": session_id}


def cleanup_empty_local_sessions() -> dict[str, Any]:
    removed = 0
    for path in SESSION_DIR.glob('*.json'):
        try:
            with path.open('r', encoding='utf-8') as fh:
                payload = json.load(fh)
        except (json.JSONDecodeError, OSError):
            continue
        if snapshot_is_meaningful(payload):
            continue
        path.unlink(missing_ok=True)
        removed += 1
    return {"status": "cleaned", "removed": removed}
