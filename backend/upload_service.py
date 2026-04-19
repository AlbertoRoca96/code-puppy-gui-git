from __future__ import annotations

import json
import re
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any

import httpx
from fastapi import HTTPException, UploadFile
from fastapi.responses import FileResponse

from backend.config import SUPABASE_ENABLED, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET, SUPABASE_URL, UPLOAD_DIR, UPLOAD_ID_PATTERN


def sanitize_upload_id(upload_id: str) -> str:
    if not UPLOAD_ID_PATTERN.fullmatch(upload_id):
        raise HTTPException(status_code=400, detail="Invalid upload id")
    return upload_id


def sanitize_filename(filename: str | None) -> str:
    raw = (filename or "upload.bin").strip()
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", raw)
    return cleaned[:120] or "upload.bin"


def upload_metadata_file(upload_id: str) -> Path:
    return UPLOAD_DIR / f"{sanitize_upload_id(upload_id)}.json"


def upload_binary_prefix(upload_id: str) -> str:
    return f"{sanitize_upload_id(upload_id)}_"


def upload_binary_file(upload_id: str, filename: str) -> Path:
    return UPLOAD_DIR / f"{upload_binary_prefix(upload_id)}{sanitize_filename(filename)}"


def find_upload_binary_file(upload_id: str) -> Path | None:
    matches = sorted(UPLOAD_DIR.glob(f"{upload_binary_prefix(upload_id)}*"))
    return matches[0] if matches else None


def base_public_url() -> str:
    import os
    return os.environ.get("CODE_PUPPY_PUBLIC_BASE_URL", "").rstrip("/")


def build_upload_url(upload_id: str, filename: str) -> str:
    safe_name = sanitize_filename(filename)
    path = f"/api/upload/{upload_id}/content?filename={safe_name}"
    base = base_public_url()
    return f"{base}{path}" if base else path


def supabase_object_key(upload_id: str, filename: str, user_id: str | None = None) -> str:
    safe_id = sanitize_upload_id(upload_id)
    safe_name = sanitize_filename(filename)
    safe_user = re.sub(r"[^A-Za-z0-9_-]+", "_", (user_id or "anonymous"))[:128]
    return f"uploads/{safe_user}/{safe_id}/{safe_name}"


def supabase_metadata_key(upload_id: str, user_id: str | None = None) -> str:
    safe_id = sanitize_upload_id(upload_id)
    safe_user = re.sub(r"[^A-Za-z0-9_-]+", "_", (user_id or "anonymous"))[:128]
    return f"uploads/{safe_user}/{safe_id}/metadata.json"


def supabase_storage_url(object_key: str) -> str:
    return f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_STORAGE_BUCKET}/{object_key}"


def supabase_headers(content_type: str | None = None) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
    }
    if content_type:
        headers["Content-Type"] = content_type
    return headers


async def supabase_upload_bytes(object_key: str, content: bytes, content_type: str) -> None:
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
        response = await client.post(
            supabase_storage_url(object_key),
            headers={**supabase_headers(content_type), "x-upsert": "true"},
            content=content,
        )
    response.raise_for_status()


async def supabase_download_bytes(object_key: str) -> bytes:
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
        response = await client.get(supabase_storage_url(object_key), headers=supabase_headers())
    if response.status_code == 404:
        raise HTTPException(status_code=404, detail="Upload not found")
    response.raise_for_status()
    return response.content


def load_upload_metadata(upload_id: str) -> dict[str, Any]:
    metadata_path = upload_metadata_file(upload_id)
    if not metadata_path.exists():
        raise HTTPException(status_code=404, detail="Upload not found")
    try:
        with metadata_path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="Upload metadata is corrupted") from exc


async def load_upload_metadata_async(upload_id: str, user_id: str | None = None) -> dict[str, Any]:
    if SUPABASE_ENABLED:
        key = supabase_metadata_key(upload_id, user_id)
        try:
            payload = await supabase_download_bytes(key)
        except HTTPException:
            raise
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"Supabase metadata fetch failed: {exc}") from exc
        try:
            return json.loads(payload.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=500, detail="Upload metadata is corrupted") from exc
    return load_upload_metadata(upload_id)


async def download_attachment_to_temp_file(metadata: dict[str, Any]) -> Path | None:
    object_key = metadata.get("storageObjectKey")
    if not object_key:
        return None
    try:
        payload = await supabase_download_bytes(str(object_key))
    except (HTTPException, httpx.HTTPError):
        return None
    suffix = Path(str(metadata.get("name") or "upload.bin")).suffix or ".bin"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp.write(payload)
    tmp.flush()
    tmp.close()
    return Path(tmp.name)


async def create_upload(file: UploadFile, kind: str, user_id: str | None) -> dict[str, Any]:
    upload_id = uuid.uuid4().hex
    filename = sanitize_filename(file.filename)
    content = await file.read()
    metadata = {
        "uploadId": upload_id,
        "name": filename,
        "kind": kind[:32] or "file",
        "mimeType": file.content_type,
        "size": len(content),
        "url": build_upload_url(upload_id, filename),
        "createdAt": time.time(),
        "userId": user_id,
    }
    if SUPABASE_ENABLED:
        object_key = supabase_object_key(upload_id, filename, user_id)
        metadata_key = supabase_metadata_key(upload_id, user_id)
        metadata["storageObjectKey"] = object_key
        metadata["storageMetadataKey"] = metadata_key
        try:
            await supabase_upload_bytes(object_key, content, file.content_type or "application/octet-stream")
            await supabase_upload_bytes(
                metadata_key,
                json.dumps(metadata, ensure_ascii=False).encode("utf-8"),
                "application/json",
            )
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"Supabase upload failed: {exc}") from exc
    else:
        with upload_binary_file(upload_id, filename).open("wb") as fh:
            fh.write(content)
        with upload_metadata_file(upload_id).open("w", encoding="utf-8") as fh:
            json.dump(metadata, fh, ensure_ascii=False)
    await file.close()
    return metadata


async def get_upload(upload_id: str, user_id: str | None) -> dict[str, Any]:
    metadata = await load_upload_metadata_async(upload_id, user_id)
    if metadata.get("userId") and user_id and metadata.get("userId") != user_id:
        raise HTTPException(status_code=404, detail="Upload not found")
    return metadata


async def get_upload_content_response(upload_id: str, user_id: str | None):
    metadata = await get_upload(upload_id, user_id)
    filename = sanitize_filename(str(metadata.get("name") or "upload.bin"))
    content_type = str(metadata.get("mimeType") or "application/octet-stream")
    if SUPABASE_ENABLED:
        object_key = metadata.get("storageObjectKey")
        if not object_key:
            raise HTTPException(status_code=404, detail="Upload content not found")
        try:
            payload = await supabase_download_bytes(str(object_key))
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"Supabase content fetch failed: {exc}") from exc
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=Path(filename).suffix or ".bin")
        tmp.write(payload)
        tmp.flush()
        tmp.close()
        return FileResponse(tmp.name, media_type=content_type, filename=filename)
    binary_path = find_upload_binary_file(upload_id)
    if not binary_path or not binary_path.exists():
        raise HTTPException(status_code=404, detail="Upload content not found")
    return FileResponse(str(binary_path), media_type=content_type, filename=filename)
