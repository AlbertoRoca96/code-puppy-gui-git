"""FastAPI service that exposes the Code Puppy worker over HTTP."""
from __future__ import annotations

import asyncio
import configparser
import csv
import io
import json
import os
import re
import shutil
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List

import httpx
import pytesseract
from docx import Document
from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel
from pypdf import PdfReader

app = FastAPI(title="Code Puppy API", version="0.1.0")
_ALLOWED_CORS_ORIGINS = [
    "https://albertoroca96.github.io",
    "http://localhost:8081",
    "http://localhost:19006",
    "http://127.0.0.1:8081",
    "http://127.0.0.1:19006",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _apply_cors_headers(request: Request, response: JSONResponse | Any) -> Any:
    origin = request.headers.get("origin", "")
    if origin in _ALLOWED_CORS_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Vary"] = "Origin"
    return response


@app.middleware("http")
async def add_explicit_cors_headers(request: Request, call_next):
    response = await call_next(request)
    return _apply_cors_headers(request, response)


@app.exception_handler(HTTPException)
async def handle_http_exception(request: Request, exc: HTTPException):
    response = JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    return _apply_cors_headers(request, response)


@app.exception_handler(Exception)
async def handle_unexpected_exception(request: Request, exc: Exception):
    response = JSONResponse(status_code=500, content={"detail": str(exc) or "Internal server error"})
    return _apply_cors_headers(request, response)

_ATTACHMENT_TEXT_EXTENSIONS = {
    ".txt",
    ".md",
    ".markdown",
    ".json",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".py",
    ".java",
    ".kt",
    ".swift",
    ".rb",
    ".go",
    ".rs",
    ".php",
    ".html",
    ".css",
    ".scss",
    ".xml",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".cfg",
    ".sql",
    ".sh",
    ".bat",
    ".ps1",
    ".csv",
    ".log",
}
_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}
_OPENAI_VISION_MODELS = (
    "gpt-4.1",
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4.1-mini",
)
_MAX_ATTACHMENT_BYTES = 8_000_000
_MAX_ATTACHMENT_TEXT_CHARS = 12_000
_MAX_TOTAL_ATTACHMENT_CONTEXT_CHARS = 24_000
_MAX_CSV_PREVIEW_ROWS = 12
_MAX_CSV_PREVIEW_COLS = 8
_MAX_DOCX_PARAGRAPHS = 80
_MAX_IMAGE_OCR_CHARS = 6000
_SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
_SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
_SUPABASE_STORAGE_BUCKET = os.environ.get("SUPABASE_STORAGE_BUCKET", "")
_SUPABASE_ENABLED = bool(
    _SUPABASE_URL and _SUPABASE_SERVICE_ROLE_KEY and _SUPABASE_STORAGE_BUCKET
)
_SUPABASE_DB_ENABLED = bool(_SUPABASE_URL and _SUPABASE_SERVICE_ROLE_KEY)


class RunRequest(BaseModel):
    prompt: str


class AttachmentRef(BaseModel):
    id: str
    name: str
    kind: str
    mimeType: str | None = None
    uri: str | None = None
    uploadId: str | None = None
    url: str | None = None
    size: int | None = None


class ChatRequest(BaseModel):
    messages: List[Dict[str, Any]]
    systemPrompt: str | None = None
    model: str | None = None
    temperature: float | None = None
    attachments: List[AttachmentRef] | None = None


class SessionSnapshot(BaseModel):
    messages: List[Dict[str, Any]] = []
    composer: str | None = ""
    presetId: str | None = None
    systemPrompt: str | None = None
    apiBase: str | None = None
    updatedAt: float | None = None
    model: str | None = None

    class Config:
        extra = "allow"


_SESSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_UPLOAD_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def _legacy_session_dir() -> Path:
    return Path(tempfile.gettempdir()) / "code_puppy_sessions"


def _resolve_session_dir() -> Path:
    override = os.environ.get("CODE_PUPPY_SESSION_DIR")
    if override:
        path = Path(override)
        path.mkdir(parents=True, exist_ok=True)
        return path

    candidates: list[Path] = []

    if sys.platform.startswith("win"):
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            candidates.append(Path(local_app_data) / "CodePuppy" / "sessions")

    xdg_state = os.environ.get("XDG_STATE_HOME")
    if xdg_state:
        candidates.append(Path(xdg_state) / "code_puppy" / "sessions")

    home = Path.home()
    if str(home):
        candidates.append(home / ".code_puppy" / "sessions")

    candidates.append(_legacy_session_dir())

    for candidate in candidates:
        try:
            candidate.mkdir(parents=True, exist_ok=True)
            return candidate
        except OSError:
            continue

    fallback = _legacy_session_dir()
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


def _resolve_upload_dir() -> Path:
    override = os.environ.get("CODE_PUPPY_UPLOAD_DIR")
    if override:
        path = Path(override)
        path.mkdir(parents=True, exist_ok=True)
        return path

    upload_dir = _resolve_session_dir().parent / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    return upload_dir


def _migrate_legacy_sessions(target_dir: Path) -> None:
    legacy_dir = _legacy_session_dir()
    if not legacy_dir.exists():
        return
    try:
        if legacy_dir.resolve() == target_dir.resolve():
            return
    except OSError:
        pass
    for source in legacy_dir.glob("*.json"):
        destination = target_dir / source.name
        if destination.exists():
            continue
        try:
            shutil.copy2(source, destination)
        except OSError:
            continue


_SESSION_DIR = _resolve_session_dir()
_UPLOAD_DIR = _resolve_upload_dir()
_migrate_legacy_sessions(_SESSION_DIR)

if _UPLOAD_DIR.exists():
    app.mount("/uploads", StaticFiles(directory=_UPLOAD_DIR), name="uploads")

_WORKER_ENV_READY = False


def _ensure_worker_environment() -> None:
    global _WORKER_ENV_READY
    if _WORKER_ENV_READY:
        return

    runtime_root = Path(
        os.environ.get("CODE_PUPPY_RUNTIME_DIR")
        or Path(tempfile.gettempdir()) / "code_puppy_runtime"
    )

    xdg_mapping = {
        "XDG_CONFIG_HOME": runtime_root / "config",
        "XDG_DATA_HOME": runtime_root / "data",
        "XDG_CACHE_HOME": runtime_root / "cache",
        "XDG_STATE_HOME": runtime_root / "state",
    }

    for env_name, base_path in xdg_mapping.items():
        os.environ.setdefault(env_name, str(base_path))
        target = base_path / "code_puppy"
        target.mkdir(parents=True, exist_ok=True)

    config_dir = Path(os.environ["XDG_CONFIG_HOME"]) / "code_puppy"
    config_path = config_dir / "puppy.cfg"
    if not config_path.exists():
        parser = configparser.ConfigParser()
        parser["puppy"] = {
            "puppy_name": os.environ.get("CODE_PUPPY_NAME", "Code Puppy"),
            "owner_name": os.environ.get("CODE_PUPPY_OWNER", "Web UI"),
            "auto_save_session": "true",
            "allow_recursion": "true",
        }
        with config_path.open("w", encoding="utf-8") as fh:
            parser.write(fh)

    _WORKER_ENV_READY = True


def _format_event(line: str) -> Dict[str, Any]:
    try:
        payload = json.loads(line)
    except json.JSONDecodeError:
        return {"event": "raw", "content": line}

    event = payload.get("event", "log")
    content = payload.get("content") or payload.get("message") or ""
    return {
        "event": event,
        "content": content,
        **{k: v for k, v in payload.items() if k not in {"event", "content"}},
    }


def _session_file(session_id: str) -> Path:
    if not _SESSION_ID_PATTERN.fullmatch(session_id):
        raise HTTPException(status_code=400, detail="Invalid session id")
    return _SESSION_DIR / f"{session_id}.json"


def _sanitize_upload_id(upload_id: str) -> str:
    if not _UPLOAD_ID_PATTERN.fullmatch(upload_id):
        raise HTTPException(status_code=400, detail="Invalid upload id")
    return upload_id


def _sanitize_filename(filename: str | None) -> str:
    raw = (filename or "upload.bin").strip()
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", raw)
    return cleaned[:120] or "upload.bin"


def _upload_metadata_file(upload_id: str) -> Path:
    safe_id = _sanitize_upload_id(upload_id)
    return _UPLOAD_DIR / f"{safe_id}.json"


def _supabase_object_key(upload_id: str, filename: str, user_id: str | None = None) -> str:
    safe_id = _sanitize_upload_id(upload_id)
    safe_name = _sanitize_filename(filename)
    safe_user = re.sub(r"[^A-Za-z0-9_-]+", "_", (user_id or "anonymous"))[:128]
    return f"uploads/{safe_user}/{safe_id}/{safe_name}"


def _supabase_metadata_key(upload_id: str, user_id: str | None = None) -> str:
    safe_id = _sanitize_upload_id(upload_id)
    safe_user = re.sub(r"[^A-Za-z0-9_-]+", "_", (user_id or "anonymous"))[:128]
    return f"uploads/{safe_user}/{safe_id}/metadata.json"


def _supabase_storage_url(object_key: str) -> str:
    return (
        f"{_SUPABASE_URL}/storage/v1/object/{_SUPABASE_STORAGE_BUCKET}/{object_key}"
    )


def _supabase_headers(content_type: str | None = None) -> Dict[str, str]:
    headers = {
        "Authorization": f"Bearer {_SUPABASE_SERVICE_ROLE_KEY}",
        "apikey": _SUPABASE_SERVICE_ROLE_KEY,
    }
    if content_type:
        headers["Content-Type"] = content_type
    return headers


def _upload_binary_prefix(upload_id: str) -> str:
    safe_id = _sanitize_upload_id(upload_id)
    return f"{safe_id}_"


def _upload_binary_file(upload_id: str, filename: str) -> Path:
    return _UPLOAD_DIR / f"{_upload_binary_prefix(upload_id)}{_sanitize_filename(filename)}"


def _find_upload_binary_file(upload_id: str) -> Path | None:
    prefix = _upload_binary_prefix(upload_id)
    matches = sorted(_UPLOAD_DIR.glob(f"{prefix}*"))
    return matches[0] if matches else None


def _base_public_url() -> str:
    return os.environ.get("CODE_PUPPY_PUBLIC_BASE_URL", "").rstrip("/")


def _build_upload_url(upload_id: str, filename: str) -> str:
    if _SUPABASE_ENABLED:
        return _supabase_storage_url(_supabase_object_key(upload_id, filename))
    base = _base_public_url()
    safe_name = _sanitize_filename(filename)
    path = f"/uploads/{upload_id}_{safe_name}"
    return f"{base}{path}" if base else path


async def _supabase_upload_bytes(
    object_key: str,
    content: bytes,
    content_type: str,
) -> None:
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
        response = await client.post(
            _supabase_storage_url(object_key),
            headers={
                **_supabase_headers(content_type),
                "x-upsert": "true",
            },
            content=content,
        )
        response.raise_for_status()


async def _supabase_download_bytes(object_key: str) -> bytes:
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
        response = await client.get(
            _supabase_storage_url(object_key),
            headers=_supabase_headers(),
        )
        if response.status_code == 404:
            raise HTTPException(status_code=404, detail="Upload not found")
        response.raise_for_status()
        return response.content


async def _load_upload_metadata_async(upload_id: str, user_id: str | None = None) -> Dict[str, Any]:
    if _SUPABASE_ENABLED:
        try:
            payload = await _supabase_download_bytes(_supabase_metadata_key(upload_id, user_id))
        except HTTPException:
            raise
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"Supabase metadata fetch failed: {exc}") from exc
        try:
            return json.loads(payload.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=500, detail="Upload metadata is corrupted") from exc
    return _load_upload_metadata(upload_id)


async def _download_attachment_to_temp_file(metadata: Dict[str, Any]) -> Path | None:
    object_key = metadata.get("storageObjectKey")
    if not object_key:
        return None
    try:
        payload = await _supabase_download_bytes(str(object_key))
    except HTTPException:
        return None
    except httpx.HTTPError:
        return None

    suffix = Path(str(metadata.get("name") or "upload.bin")).suffix or ".bin"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp.write(payload)
    tmp.flush()
    tmp.close()
    return Path(tmp.name)


async def _supabase_db_request(
    method: str,
    path: str,
    *,
    params: Dict[str, Any] | None = None,
    json_body: Any | None = None,
    prefer: str | None = None,
) -> Any:
    if not _SUPABASE_DB_ENABLED:
        raise HTTPException(status_code=503, detail="Supabase DB is not configured")
    headers = {
        **_supabase_headers("application/json"),
        "Accept": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
        response = await client.request(
            method,
            f"{_SUPABASE_URL}/rest/v1/{path.lstrip('/')}",
            headers=headers,
            params=params,
            json=json_body,
        )
        if response.status_code >= 400:
            detail = response.text or response.reason_phrase
            raise HTTPException(status_code=response.status_code, detail=detail)
        if not response.text:
            return None
        return response.json()


async def _get_current_user(authorization: str | None) -> Dict[str, Any]:
    if not _SUPABASE_DB_ENABLED:
        raise HTTPException(status_code=503, detail="Supabase auth is not configured")
    token = (authorization or "").strip()
    if not token.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    access_token = token.split(" ", 1)[1].strip()
    if not access_token:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
        response = await client.get(
            f"{_SUPABASE_URL}/auth/v1/user",
            headers={
                "Authorization": f"Bearer {access_token}",
                "apikey": _SUPABASE_SERVICE_ROLE_KEY,
            },
        )
        if response.status_code >= 400:
            detail = response.text or response.reason_phrase
            raise HTTPException(status_code=401, detail=detail)
        user = response.json()
        if not isinstance(user, dict) or not user.get("id"):
            raise HTTPException(status_code=401, detail="Invalid auth user response")
        return user


async def _load_supabase_session(session_id: str, user_id: str) -> Dict[str, Any]:
    rows = await _supabase_db_request(
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


async def _save_supabase_session(session_id: str, user_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    now = payload.get("updatedAt") or time.time()
    title = payload.get("title") or _derive_title(payload)
    message_count = len(payload.get("messages") or [])
    body = {
        "session_id": session_id,
        "user_id": user_id,
        "title": title,
        "updated_at": now,
        "message_count": message_count,
        "payload": payload,
    }
    rows = await _supabase_db_request(
        "POST",
        "/chat_sessions",
        params={"on_conflict": "user_id,session_id"},
        json_body=body,
        prefer="resolution=merge-duplicates,return=representation",
    )
    saved = rows[0] if rows else body
    return {
        "status": "saved",
        "updatedAt": saved.get("updated_at") or now,
    }


async def _list_supabase_sessions(limit: int, user_id: str) -> List[Dict[str, Any]]:
    rows = await _supabase_db_request(
        "GET",
        "/chat_sessions",
        params={
            "user_id": f"eq.{user_id}",
            "select": "session_id,title,updated_at,message_count",
            "order": "updated_at.desc",
            "limit": str(limit),
        },
    )
    return [
        {
            "sessionId": row.get("session_id"),
            "title": row.get("title") or "New chat",
            "updatedAt": row.get("updated_at") or time.time(),
            "messageCount": row.get("message_count") or 0,
        }
        for row in rows or []
    ]


async def _delete_supabase_session(session_id: str, user_id: str) -> Dict[str, Any]:
    await _supabase_db_request(
        "DELETE",
        "/chat_sessions",
        params={"session_id": f"eq.{session_id}", "user_id": f"eq.{user_id}"},
        prefer="return=representation",
    )
    return {"status": "deleted", "sessionId": session_id}


def _sanitize_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    cleaned: List[Dict[str, Any]] = []
    if not messages:
        return cleaned
    for item in messages[-200:]:
        role = item.get("role")
        content = item.get("content")
        if not role or content is None:
            continue
        cleaned.append({"role": str(role)[:32], "content": content})
    return cleaned


def _sanitize_attachments(
    attachments: List[Dict[str, Any]] | List[AttachmentRef] | None,
) -> List[Dict[str, Any]]:
    cleaned: List[Dict[str, Any]] = []
    if not attachments:
        return cleaned

    for item in attachments[-20:]:
        payload = item.model_dump() if isinstance(item, AttachmentRef) else dict(item)
        upload_id = str(payload.get("uploadId") or "").strip()
        if not upload_id:
            continue
        name = _sanitize_filename(str(payload.get("name") or "upload.bin"))
        cleaned.append(
            {
                "id": str(payload.get("id") or upload_id)[:128],
                "name": name,
                "kind": str(payload.get("kind") or "file")[:32],
                "mimeType": str(payload.get("mimeType") or "")[:120] or None,
                "uri": None,
                "uploadId": upload_id,
                "url": _build_upload_url(upload_id, name),
                "size": int(payload.get("size") or 0) or None,
            }
        )
    return cleaned


def _derive_title(payload: Dict[str, Any]) -> str:
    title = str(payload.get("title") or "").strip()
    if title:
        return title[:120]
    for message in payload.get("messages") or []:
        if message.get("role") == "user":
            content = message.get("content")
            if isinstance(content, str) and content.strip():
                return content.strip()[:120]
    return "New chat"


def _truncate_text(text: str, limit: int = _MAX_ATTACHMENT_TEXT_CHARS) -> str:
    compact = text.replace("\x00", "").strip()
    if len(compact) <= limit:
        return compact
    return compact[:limit] + "\n...[truncated]"


def _looks_like_text_file(path: Path, mime_type: str | None) -> bool:
    if mime_type and (
        mime_type.startswith("text/")
        or mime_type
        in {"application/json", "application/xml", "application/javascript"}
    ):
        return True
    return path.suffix.lower() in _ATTACHMENT_TEXT_EXTENSIONS


def _is_image_file(path: Path, mime_type: str | None) -> bool:
    if mime_type and mime_type.startswith("image/"):
        return True
    return path.suffix.lower() in _IMAGE_EXTENSIONS


def _extract_pdf_text(path: Path) -> str:
    reader = PdfReader(str(path))
    chunks: List[str] = []
    for page in reader.pages[:20]:
        try:
            chunks.append(page.extract_text() or "")
        except Exception:
            continue
    return "\n".join(chunk for chunk in chunks if chunk.strip())


def _extract_docx_text(path: Path) -> str:
    document = Document(str(path))
    chunks: List[str] = []
    for paragraph in document.paragraphs[:_MAX_DOCX_PARAGRAPHS]:
        text = (paragraph.text or "").strip()
        if text:
            chunks.append(text)
    return "\n".join(chunks)


def _extract_csv_preview(path: Path) -> str:
    raw_text = path.read_text(encoding="utf-8", errors="replace")
    reader = csv.reader(io.StringIO(raw_text))
    rows = [row for _, row in zip(range(_MAX_CSV_PREVIEW_ROWS + 1), reader)]
    if not rows:
        return "CSV appears empty."

    header = rows[0][:_MAX_CSV_PREVIEW_COLS]
    body = rows[1 : _MAX_CSV_PREVIEW_ROWS + 1]
    lines = [
        f"Columns ({len(header)} shown): {', '.join(cell.strip() or '[blank]' for cell in header)}"
    ]
    for index, row in enumerate(body, start=1):
        visible = row[:_MAX_CSV_PREVIEW_COLS]
        rendered = " | ".join(cell.strip() or "[blank]" for cell in visible)
        lines.append(f"Row {index}: {rendered}")
    return "\n".join(lines)


def _extract_image_ocr(path: Path) -> str | None:
    return (
        "Image OCR skipped for chat context. Use image metadata and multimodal analysis when available."
    )


def _extract_attachment_text(path: Path, mime_type: str | None) -> str | None:
    if not path.exists() or not path.is_file():
        return None
    if path.stat().st_size > _MAX_ATTACHMENT_BYTES:
        return f"File too large to inline safely ({path.stat().st_size} bytes)."

    suffix = path.suffix.lower()
    try:
        if suffix == ".pdf" or mime_type == "application/pdf":
            text = _extract_pdf_text(path)
            return (
                _truncate_text(text)
                if text.strip()
                else "PDF text extraction returned no text."
            )
        if suffix == ".docx" or mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            text = _extract_docx_text(path)
            return (
                _truncate_text(text)
                if text.strip()
                else "DOCX extraction returned no text."
            )
        if suffix == ".csv" or mime_type == "text/csv":
            return _truncate_text(_extract_csv_preview(path))
        if _is_image_file(path, mime_type):
            return _extract_image_ocr(path)
        if _looks_like_text_file(path, mime_type):
            text = path.read_text(encoding="utf-8", errors="replace")
            return _truncate_text(text)
    except Exception as exc:
        return f"Failed to extract attachment text: {exc}"

    return None


def _load_upload_metadata(upload_id: str) -> Dict[str, Any]:
    metadata_file = _upload_metadata_file(upload_id)
    if not metadata_file.exists():
        raise HTTPException(status_code=404, detail="Upload not found")
    try:
        with metadata_file.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="Upload metadata is corrupted") from exc


def _resolve_attachment_records_sync(attachments: List[AttachmentRef] | None) -> List[Dict[str, Any]]:
    if not attachments:
        return []

    records: List[Dict[str, Any]] = []
    for item in attachments:
        if not item.uploadId:
            continue
        try:
            metadata = _load_upload_metadata(item.uploadId)
            binary_path = _find_upload_binary_file(item.uploadId)
            extracted_text = (
                _extract_attachment_text(binary_path, metadata.get("mimeType"))
                if binary_path
                else None
            )
            records.append(
                {
                    "item": item,
                    "metadata": metadata,
                    "binary_path": binary_path,
                    "extracted_text": extracted_text,
                    "is_image": _is_image_file(
                        binary_path or Path(metadata.get("name") or "upload.bin"),
                        metadata.get("mimeType"),
                    ),
                }
            )
        except Exception:
            continue
    return records


async def _resolve_attachment_records(
    attachments: List[AttachmentRef] | None,
    user_id: str | None = None,
) -> List[Dict[str, Any]]:
    if not attachments:
        return []
    if not _SUPABASE_ENABLED:
        return _resolve_attachment_records_sync(attachments)

    records: List[Dict[str, Any]] = []
    for item in attachments:
        if not item.uploadId:
            continue
        try:
            metadata = await _load_upload_metadata_async(item.uploadId, user_id)
            binary_path = await _download_attachment_to_temp_file(metadata)
            extracted_text = (
                _extract_attachment_text(binary_path, metadata.get("mimeType"))
                if binary_path
                else None
            )
            records.append(
                {
                    "item": item,
                    "metadata": metadata,
                    "binary_path": binary_path,
                    "extracted_text": extracted_text,
                    "is_image": _is_image_file(
                        binary_path or Path(metadata.get("name") or "upload.bin"),
                        metadata.get("mimeType"),
                    ),
                }
            )
        except Exception:
            continue
    return records


def _build_attachment_context_from_records(records: List[Dict[str, Any]]) -> str:
    if not records:
        return ""

    sections: List[str] = []
    consumed_chars = 0
    for record in records:
        item = record["item"]
        metadata = record["metadata"]
        extracted_text = record["extracted_text"]

        section_lines = [
            f"Attachment: {metadata.get('name') or item.name}",
            f"Kind: {metadata.get('kind') or item.kind}",
            f"MIME type: {metadata.get('mimeType') or item.mimeType or 'unknown'}",
            f"URL: {metadata.get('url') or item.url or 'unavailable'}",
        ]
        if extracted_text:
            section_lines.append("Extracted content:")
            section_lines.append(extracted_text)
        else:
            section_lines.append(
                "Extracted content: not available. Use filename/type metadata only."
            )

        block = "\n".join(section_lines).strip()
        if not block:
            continue

        remaining = _MAX_TOTAL_ATTACHMENT_CONTEXT_CHARS - consumed_chars
        if remaining <= 0:
            break
        clipped = block[:remaining]
        sections.append(clipped)
        consumed_chars += len(clipped)

    if not sections:
        return ""

    return (
        "User attached the following files. Use their contents when relevant:\n\n"
        + "\n\n---\n\n".join(sections)
    )


def _supports_openai_vision(model: str) -> bool:
    return any(token in model for token in _OPENAI_VISION_MODELS)


def _append_multimodal_images(
    messages: List[Dict[str, Any]], records: List[Dict[str, Any]], is_openai: bool, model: str
) -> List[Dict[str, Any]]:
    if not is_openai or not _supports_openai_vision(model):
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
    last_user_index = None
    for index in range(len(updated) - 1, -1, -1):
        if updated[index].get("role") == "user":
            last_user_index = index
            break

    if last_user_index is None:
        return updated

    original_content = updated[last_user_index].get("content")
    if isinstance(original_content, list):
        content_blocks = list(original_content)
    else:
        content_blocks = [{"type": "text", "text": str(original_content or "")}]

    for url in image_urls:
        content_blocks.append({"type": "image_url", "image_url": {"url": url}})

    updated[last_user_index] = {
        **updated[last_user_index],
        "content": content_blocks,
    }
    return updated


async def _invoke_syn_chat(
    payload: ChatRequest,
    user_id: str | None = None,
) -> Dict[str, Any]:
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages cannot be empty")

    configured_model = payload.model or os.environ.get(
        "CODE_PUPPY_CHAT_MODEL", "hf:zai-org/GLM-4.7"
    )

    is_openai = configured_model.startswith("openai:")
    forwarded_model = configured_model
    if is_openai:
        api_key = os.environ.get("OPEN_API_KEY") or os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise HTTPException(status_code=503, detail="OPEN_API_KEY is not configured")
        forwarded_model = configured_model.replace("openai:", "", 1)
        base_url = os.environ.get(
            "OPENAI_CHAT_URL", "https://api.openai.com/v1/chat/completions"
        )
    else:
        api_key = os.environ.get("SYN_API_KEY")
        if not api_key:
            raise HTTPException(status_code=503, detail="SYN_API_KEY is not configured")
        base_url = os.environ.get(
            "SYN_CHAT_URL", "https://api.synthetic.new/openai/v1/chat/completions"
        )

    attachment_records = await _resolve_attachment_records(payload.attachments, user_id)
    attachment_context = _build_attachment_context_from_records(attachment_records)

    chat_messages: List[Dict[str, Any]] = []
    if payload.systemPrompt:
        chat_messages.append({"role": "system", "content": payload.systemPrompt})
    if attachment_context:
        chat_messages.append({"role": "system", "content": attachment_context})

    for message in payload.messages:
        role = message.get("role")
        content = message.get("content")
        if not role or content is None:
            continue
        chat_messages.append({"role": role, "content": content})

    chat_messages = _append_multimodal_images(
        chat_messages, attachment_records, is_openai, forwarded_model
    )

    if not chat_messages:
        raise HTTPException(status_code=400, detail="messages missing content")

    request_body: Dict[str, Any] = {
        "model": forwarded_model,
        "messages": chat_messages,
        "temperature": payload.temperature if payload.temperature is not None else 0.2,
        "stream": False,
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
        try:
            response = await client.post(base_url, headers=headers, json=request_body)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text or exc.response.reason_phrase
            raise HTTPException(status_code=exc.response.status_code, detail=detail) from exc
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    data = response.json()
    choices = data.get("choices") or []
    message_text = ""
    if choices:
        message_text = choices[0].get("message", {}).get("content", "")
    return {
        "message": message_text,
        "raw": data,
        "usage": data.get("usage", {}),
        "model": forwarded_model,
    }


async def _run_worker(prompt: str) -> Dict[str, Any]:
    _ensure_worker_environment()

    env = os.environ.copy()
    env.setdefault("PYTHONIOENCODING", "utf-8")
    if "SYN_API_KEY" in os.environ:
        env["SYN_API_KEY"] = os.environ["SYN_API_KEY"]

    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "code_puppy_gui.worker",
        "--prompt",
        prompt,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )

    logs: List[Dict[str, Any]] = []
    response_text: str | None = None

    assert process.stdout is not None
    assert process.stderr is not None

    async def _consume_stdout() -> None:
        nonlocal response_text
        async for raw_line in process.stdout:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            event = _format_event(line)
            if event.get("event") == "agent_response":
                response_text = event.get("content")
            logs.append(event)

    async def _consume_stderr() -> str:
        chunks: List[str] = []
        async for raw_line in process.stderr:
            chunks.append(raw_line.decode("utf-8", errors="replace"))
        return "".join(chunks)

    stdout_task = asyncio.create_task(_consume_stdout())
    stderr_task = asyncio.create_task(_consume_stderr())

    exit_code = await process.wait()
    await stdout_task
    stderr_output = await stderr_task

    return {
        "exitCode": exit_code,
        "logs": logs,
        "response": response_text,
        "stderr": stderr_output,
    }


@app.post("/api/run")
async def run_code_puppy(req: RunRequest) -> Dict[str, Any]:
    if not req.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt cannot be empty")

    result = await _run_worker(req.prompt)
    return {
        "response": result.get("response") or "",
        "logs": result.get("logs", []),
        "stderr": result.get("stderr", ""),
        "exitCode": result.get("exitCode", 1),
    }


@app.post("/api/chat")
async def chat(
    payload: ChatRequest,
    authorization: str | None = Header(default=None),
) -> Dict[str, Any]:
    current_user = await _get_current_user(authorization) if _SUPABASE_DB_ENABLED else None
    return await _invoke_syn_chat(
        payload,
        str(current_user.get("id")) if current_user else None,
    )


@app.post("/api/uploads")
async def upload_attachment(
    file: UploadFile = File(...),
    kind: str = Form("file"),
    authorization: str | None = Header(default=None),
) -> Dict[str, Any]:
    upload_id = uuid.uuid4().hex
    filename = _sanitize_filename(file.filename)
    content = await file.read()
    size = len(content)

    metadata = {
        "uploadId": upload_id,
        "name": filename,
        "kind": kind[:32] or "file",
        "mimeType": file.content_type,
        "size": size,
        "url": _build_upload_url(upload_id, filename),
        "createdAt": time.time(),
    }

    current_user = await _get_current_user(authorization) if _SUPABASE_DB_ENABLED else None
    user_id = str(current_user.get("id")) if current_user else None

    if _SUPABASE_ENABLED:
        object_key = _supabase_object_key(upload_id, filename, user_id)
        metadata_key = _supabase_metadata_key(upload_id, user_id)
        metadata["storageObjectKey"] = object_key
        metadata["storageMetadataKey"] = metadata_key
        metadata["userId"] = user_id
        try:
            await _supabase_upload_bytes(
                object_key,
                content,
                file.content_type or "application/octet-stream",
            )
            await _supabase_upload_bytes(
                metadata_key,
                json.dumps(metadata, ensure_ascii=False).encode("utf-8"),
                "application/json",
            )
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"Supabase upload failed: {exc}") from exc
    else:
        target_file = _upload_binary_file(upload_id, filename)
        metadata_file = _upload_metadata_file(upload_id)
        with target_file.open("wb") as fh:
            fh.write(content)
        with metadata_file.open("w", encoding="utf-8") as fh:
            json.dump(metadata, fh, ensure_ascii=False)

    await file.close()
    return metadata


@app.get("/api/upload/{upload_id}")
async def get_upload(
    upload_id: str,
    authorization: str | None = Header(default=None),
) -> Dict[str, Any]:
    current_user = await _get_current_user(authorization) if _SUPABASE_DB_ENABLED else None
    metadata = await _load_upload_metadata_async(
        upload_id,
        str(current_user.get("id")) if current_user else None,
    )
    if current_user and metadata.get("userId") != current_user.get("id"):
        raise HTTPException(status_code=404, detail="Upload not found")
    return metadata


@app.get("/api/session/{session_id}")
async def load_session(
    session_id: str,
    authorization: str | None = Header(default=None),
) -> Dict[str, Any]:
    _session_file(session_id)
    if _SUPABASE_DB_ENABLED:
        current_user = await _get_current_user(authorization)
        data = await _load_supabase_session(session_id, str(current_user.get("id")))
    else:
        path = _session_file(session_id)
        if not path.exists():
            raise HTTPException(status_code=404, detail="Session not found")
        try:
            with path.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=500, detail="Session file is corrupted") from exc
    data.setdefault("sessionId", session_id)
    data.setdefault("title", _derive_title(data))
    data["attachments"] = _sanitize_attachments(data.get("attachments") or [])
    return data


@app.get("/api/sessions")
async def list_sessions(
    limit: int = 50,
    authorization: str | None = Header(default=None),
) -> Dict[str, Any]:
    max_items = max(1, min(limit, 100))
    if _SUPABASE_DB_ENABLED:
        current_user = await _get_current_user(authorization)
        return {"sessions": await _list_supabase_sessions(max_items, str(current_user.get("id")))}

    entries: List[Dict[str, Any]] = []
    files = sorted(_SESSION_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    for path in files[:max_items]:
        try:
            with path.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (json.JSONDecodeError, OSError):
            continue
        updated_at = data.get("updatedAt") or path.stat().st_mtime
        entries.append(
            {
                "sessionId": data.get("sessionId") or path.stem,
                "title": data.get("title") or _derive_title(data),
                "updatedAt": updated_at,
                "messageCount": len(data.get("messages") or []),
            }
        )
    return {"sessions": entries}


@app.put("/api/session/{session_id}")
async def save_session(
    session_id: str,
    snapshot: SessionSnapshot,
    authorization: str | None = Header(default=None),
) -> Dict[str, Any]:
    _session_file(session_id)
    payload = snapshot.model_dump()
    payload["sessionId"] = session_id
    payload["updatedAt"] = snapshot.updatedAt or time.time()
    payload["messages"] = _sanitize_messages(payload.get("messages") or [])
    payload["attachments"] = _sanitize_attachments(payload.get("attachments") or [])
    payload["title"] = _derive_title(payload)

    if _SUPABASE_DB_ENABLED:
        current_user = await _get_current_user(authorization)
        payload["userId"] = str(current_user.get("id"))
        return await _save_supabase_session(session_id, str(current_user.get("id")), payload)

    path = _session_file(session_id)
    tmp_path = path.with_suffix(".tmp")
    tmp_path.parent.mkdir(parents=True, exist_ok=True)
    with tmp_path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)
    tmp_path.replace(path)
    return {"status": "saved", "updatedAt": payload["updatedAt"]}


@app.delete("/api/session/{session_id}")
async def delete_session(
    session_id: str,
    authorization: str | None = Header(default=None),
) -> Dict[str, Any]:
    _session_file(session_id)
    if _SUPABASE_DB_ENABLED:
        current_user = await _get_current_user(authorization)
        return await _delete_supabase_session(session_id, str(current_user.get("id")))

    path = _session_file(session_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Session not found")
    try:
        path.unlink()
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to delete session: {exc}") from exc
    return {"status": "deleted", "sessionId": session_id}


@app.get("/api/me")
async def me(authorization: str | None = Header(default=None)) -> Dict[str, Any]:
    if not _SUPABASE_DB_ENABLED:
        raise HTTPException(status_code=503, detail="Supabase auth is not configured")
    current_user = await _get_current_user(authorization)
    return {
        "id": str(current_user.get("id") or ""),
        "email": current_user.get("email"),
    }


@app.get("/api/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}
