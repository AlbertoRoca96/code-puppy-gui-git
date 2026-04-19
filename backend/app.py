from __future__ import annotations

import json
import time
from typing import Any, AsyncIterator

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from backend.auth_service import get_current_user
from backend.attachments_service import sanitize_attachments
from backend.config import ALLOWED_CORS_ORIGINS, MAX_MESSAGES_PER_SESSION, SUPABASE_DB_ENABLED
from backend.models import ChatRequest, RunRequest, SessionSnapshot
from backend.provider_service import invoke_chat, stream_chat
from backend.session_service import (
    cleanup_empty_local_sessions,
    cleanup_empty_supabase_sessions,
    delete_local_session,
    delete_supabase_session,
    derive_title,
    list_local_sessions,
    list_supabase_sessions,
    load_local_session,
    load_supabase_session,
    sanitize_messages,
    save_local_session,
    save_supabase_session,
    session_file,
)
from backend.upload_service import build_upload_url, create_upload, get_upload, get_upload_content_response
from backend.worker_service import run_worker

app = FastAPI(title="Code Puppy API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def apply_cors_headers(request: Request, response: JSONResponse | Any) -> Any:
    origin = request.headers.get("origin", "")
    if origin in ALLOWED_CORS_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Vary"] = "Origin"
    return response


@app.middleware("http")
async def add_explicit_cors_headers(request: Request, call_next):
    return apply_cors_headers(request, await call_next(request))


@app.exception_handler(HTTPException)
async def handle_http_exception(request: Request, exc: HTTPException):
    return apply_cors_headers(request, JSONResponse(status_code=exc.status_code, content={"detail": exc.detail}))


@app.exception_handler(Exception)
async def handle_unexpected_exception(request: Request, exc: Exception):
    return apply_cors_headers(request, JSONResponse(status_code=500, content={"detail": str(exc) or "Internal server error"}))


@app.post("/api/run")
async def run_code_puppy(req: RunRequest) -> dict[str, Any]:
    if not req.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt cannot be empty")
    result = await run_worker(req.prompt)
    return {
        "response": result.get("response") or "",
        "logs": result.get("logs", []),
        "stderr": result.get("stderr", ""),
        "exitCode": result.get("exitCode", 1),
    }


@app.post("/api/chat")
async def chat(payload: ChatRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    current_user = await get_current_user(authorization) if SUPABASE_DB_ENABLED else None
    return await invoke_chat(payload, str(current_user.get("id")) if current_user else None)


@app.post("/api/chat/stream")
async def chat_stream(payload: ChatRequest, authorization: str | None = Header(default=None)):
    current_user = await get_current_user(authorization) if SUPABASE_DB_ENABLED else None
    user_id = str(current_user.get("id")) if current_user else None

    async def event_stream() -> AsyncIterator[str]:
        async for event in stream_chat(payload, user_id):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/api/uploads")
async def upload_attachment(
    file: UploadFile = File(...),
    kind: str = Form("file"),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    current_user = await get_current_user(authorization) if SUPABASE_DB_ENABLED else None
    user_id = str(current_user.get("id")) if current_user else None
    return await create_upload(file, kind, user_id)


@app.get("/api/upload/{upload_id}")
async def fetch_upload(upload_id: str, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    current_user = await get_current_user(authorization) if SUPABASE_DB_ENABLED else None
    user_id = str(current_user.get("id")) if current_user else None
    return await get_upload(upload_id, user_id)


@app.get("/api/upload/{upload_id}/content")
async def get_upload_content(upload_id: str, authorization: str | None = Header(default=None)):
    current_user = await get_current_user(authorization) if SUPABASE_DB_ENABLED else None
    user_id = str(current_user.get("id")) if current_user else None
    return await get_upload_content_response(upload_id, user_id)


@app.get("/api/session/{session_id}")
async def load_session(session_id: str, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    session_file(session_id)
    if SUPABASE_DB_ENABLED:
        current_user = await get_current_user(authorization)
        data = await load_supabase_session(session_id, str(current_user.get("id")))
    else:
        data = load_local_session(session_id)
    data.setdefault("sessionId", session_id)
    data.setdefault("title", derive_title(data))
    data["attachments"] = sanitize_attachments(data.get("attachments") or [], build_upload_url)
    return data


@app.get("/api/sessions")
async def list_sessions(
    limit: int = 50,
    query: str = '',
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    max_items = max(1, min(limit, 100))
    if SUPABASE_DB_ENABLED:
        current_user = await get_current_user(authorization)
        return {
            "sessions": await list_supabase_sessions(
                max_items,
                str(current_user.get("id")),
                query,
            )
        }
    return {"sessions": list_local_sessions(max_items, query)}


@app.put("/api/session/{session_id}")
async def save_session(session_id: str, snapshot: SessionSnapshot, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    session_file(session_id)
    payload = snapshot.model_dump()
    payload["sessionId"] = session_id
    payload["updatedAt"] = snapshot.updatedAt or time.time()
    payload["messages"] = sanitize_messages(payload.get("messages") or [])
    payload["attachments"] = sanitize_attachments(payload.get("attachments") or [], build_upload_url)
    payload["title"] = derive_title(payload)
    payload["messageLimit"] = MAX_MESSAGES_PER_SESSION
    if SUPABASE_DB_ENABLED:
        current_user = await get_current_user(authorization)
        payload["userId"] = str(current_user.get("id"))
        return await save_supabase_session(session_id, str(current_user.get("id")), payload)
    return save_local_session(session_id, payload)


@app.delete("/api/session/{session_id}")
async def delete_session(session_id: str, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    session_file(session_id)
    if SUPABASE_DB_ENABLED:
        current_user = await get_current_user(authorization)
        return await delete_supabase_session(session_id, str(current_user.get("id")))
    return delete_local_session(session_id)


@app.post("/api/sessions/cleanup-empty")
async def cleanup_empty_sessions(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if SUPABASE_DB_ENABLED:
        current_user = await get_current_user(authorization)
        return await cleanup_empty_supabase_sessions(str(current_user.get("id")))
    return cleanup_empty_local_sessions()


@app.get("/api/me")
async def me(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not SUPABASE_DB_ENABLED:
        raise HTTPException(status_code=503, detail="Supabase auth is not configured")
    current_user = await get_current_user(authorization)
    return {"id": str(current_user.get("id") or ""), "email": current_user.get("email")}


@app.get("/api/health")
async def health() -> dict[str, str | int]:
    return {"status": "ok", "messageLimit": MAX_MESSAGES_PER_SESSION}
