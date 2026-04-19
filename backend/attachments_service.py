from __future__ import annotations

import csv
import io
import re
from html import unescape
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

try:
    import pytesseract
except ImportError:  # pragma: no cover - optional runtime dependency
    pytesseract = None

try:
    from docx import Document
except ImportError:  # pragma: no cover - optional runtime dependency
    Document = None

try:
    from PIL import Image
except ImportError:  # pragma: no cover - optional runtime dependency
    Image = None

try:
    from pypdf import PdfReader
except ImportError:  # pragma: no cover - optional runtime dependency
    PdfReader = None

from backend.config import ATTACHMENT_TEXT_EXTENSIONS, IMAGE_EXTENSIONS, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_TEXT_CHARS, MAX_CSV_PREVIEW_COLS, MAX_CSV_PREVIEW_ROWS, MAX_DOCX_PARAGRAPHS, MAX_IMAGE_OCR_CHARS, MAX_TOTAL_ATTACHMENT_CONTEXT_CHARS
from backend.models import AttachmentRef
from backend.upload_service import download_attachment_to_temp_file, find_upload_binary_file, load_upload_metadata, load_upload_metadata_async

URL_PATTERN = re.compile(r"https?://[^\s<>()]+", re.IGNORECASE)


def truncate_text(text: str, limit: int = MAX_ATTACHMENT_TEXT_CHARS) -> str:
    compact = text.replace("\x00", "").strip()
    if len(compact) <= limit:
        return compact
    return compact[:limit] + "\n...[truncated]"


def looks_like_text_file(path: Path, mime_type: str | None) -> bool:
    if mime_type and (mime_type.startswith("text/") or mime_type in {"application/json", "application/xml", "application/javascript"}):
        return True
    return path.suffix.lower() in ATTACHMENT_TEXT_EXTENSIONS


def is_image_file(path: Path, mime_type: str | None) -> bool:
    if mime_type and mime_type.startswith("image/"):
        return True
    return path.suffix.lower() in IMAGE_EXTENSIONS


def extract_pdf_text(path: Path) -> str:
    if PdfReader is None:
        return 'PDF extraction dependency is not installed on the backend.'
    reader = PdfReader(str(path))
    chunks: list[str] = []
    for page in reader.pages[:20]:
        try:
            chunks.append(page.extract_text() or "")
        except Exception:
            continue
    return "\n".join(chunk for chunk in chunks if chunk.strip())


def extract_docx_text(path: Path) -> str:
    if Document is None:
        return 'DOCX extraction dependency is not installed on the backend.'
    document = Document(str(path))
    chunks: list[str] = []
    for paragraph in document.paragraphs[:MAX_DOCX_PARAGRAPHS]:
        text = (paragraph.text or "").strip()
        if text:
            chunks.append(text)
    return "\n".join(chunks)


def extract_csv_preview(path: Path) -> str:
    raw_text = path.read_text(encoding="utf-8", errors="replace")
    reader = csv.reader(io.StringIO(raw_text))
    rows = [row for _, row in zip(range(MAX_CSV_PREVIEW_ROWS + 1), reader)]
    if not rows:
        return "CSV appears empty."
    header = rows[0][:MAX_CSV_PREVIEW_COLS]
    body = rows[1 : MAX_CSV_PREVIEW_ROWS + 1]
    lines = [f"Columns ({len(header)} shown): {', '.join(cell.strip() or '[blank]' for cell in header)}"]
    for index, row in enumerate(body, start=1):
        lines.append(f"Row {index}: {' | '.join((cell.strip() or '[blank]') for cell in row[:MAX_CSV_PREVIEW_COLS])}")
    return "\n".join(lines)


def extract_image_ocr(path: Path) -> str | None:
    if Image is None or pytesseract is None:
        return 'Image OCR dependency is not installed on the backend.'
    try:
        image = Image.open(path)
        text = pytesseract.image_to_string(image)
    except Exception as exc:
        return f"Image OCR failed: {exc}"
    cleaned = truncate_text(text, MAX_IMAGE_OCR_CHARS)
    return cleaned or "Image OCR did not detect readable text."


def extract_attachment_text(path: Path, mime_type: str | None) -> str | None:
    if not path.exists() or not path.is_file():
        return None
    if path.stat().st_size > MAX_ATTACHMENT_BYTES:
        return f"File too large to inline safely ({path.stat().st_size} bytes)."
    suffix = path.suffix.lower()
    try:
        if suffix == ".pdf" or mime_type == "application/pdf":
            text = extract_pdf_text(path)
            return truncate_text(text) if text.strip() else "PDF text extraction returned no text."
        if suffix == ".docx" or mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            text = extract_docx_text(path)
            return truncate_text(text) if text.strip() else "DOCX extraction returned no text."
        if suffix == ".csv" or mime_type == "text/csv":
            return truncate_text(extract_csv_preview(path))
        if is_image_file(path, mime_type):
            return extract_image_ocr(path)
        if looks_like_text_file(path, mime_type):
            return truncate_text(path.read_text(encoding="utf-8", errors="replace"))
    except Exception as exc:
        return f"Failed to extract attachment text: {exc}"
    return None


def sanitize_attachments(attachments: list[dict[str, Any]] | list[AttachmentRef] | None, build_upload_url) -> list[dict[str, Any]]:
    cleaned: list[dict[str, Any]] = []
    for item in attachments or []:
        payload = item.model_dump() if isinstance(item, AttachmentRef) else dict(item)
        upload_id = str(payload.get("uploadId") or "").strip()
        if not upload_id:
            continue
        name = str(payload.get("name") or "upload.bin")[:120]
        cleaned.append(
            {
                "id": str(payload.get("id") or upload_id)[:128],
                "name": name,
                "kind": str(payload.get("kind") or "file")[:32],
                "mimeType": str(payload.get("mimeType") or "")[:120] or None,
                "uri": None,
                "uploadId": upload_id,
                "url": build_upload_url(upload_id, name),
                "size": int(payload.get("size") or 0) or None,
            }
        )
    return cleaned


def resolve_attachment_records_sync(attachments: list[AttachmentRef] | None) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for item in attachments or []:
        if not item.uploadId:
            continue
        try:
            metadata = load_upload_metadata(item.uploadId)
            binary_path = find_upload_binary_file(item.uploadId)
            records.append(
                {
                    "item": item,
                    "metadata": metadata,
                    "binary_path": binary_path,
                    "extracted_text": extract_attachment_text(binary_path, metadata.get("mimeType")) if binary_path else None,
                    "is_image": is_image_file(binary_path or Path(metadata.get("name") or "upload.bin"), metadata.get("mimeType")),
                }
            )
        except Exception:
            continue
    return records


async def resolve_attachment_records(attachments: list[AttachmentRef] | None, user_id: str | None, supabase_enabled: bool) -> list[dict[str, Any]]:
    if not supabase_enabled:
        return resolve_attachment_records_sync(attachments)
    records: list[dict[str, Any]] = []
    for item in attachments or []:
        if not item.uploadId:
            continue
        try:
            metadata = await load_upload_metadata_async(item.uploadId, user_id)
            binary_path = await download_attachment_to_temp_file(metadata)
            records.append(
                {
                    "item": item,
                    "metadata": metadata,
                    "binary_path": binary_path,
                    "extracted_text": extract_attachment_text(binary_path, metadata.get("mimeType")) if binary_path else None,
                    "is_image": is_image_file(binary_path or Path(metadata.get("name") or "upload.bin"), metadata.get("mimeType")),
                }
            )
        except Exception:
            continue
    return records


def build_attachment_context_from_records(records: list[dict[str, Any]]) -> str:
    sections: list[str] = []
    consumed_chars = 0
    for record in records:
        metadata = record["metadata"]
        item = record["item"]
        lines = [
            f"Attachment: {metadata.get('name') or item.name}",
            f"Kind: {metadata.get('kind') or item.kind}",
            f"MIME type: {metadata.get('mimeType') or item.mimeType or 'unknown'}",
            f"URL: {metadata.get('url') or item.url or 'unavailable'}",
            "Extracted content:",
            record.get("extracted_text") or "not available. Use filename/type metadata only.",
        ]
        block = "\n".join(lines).strip()
        remaining = MAX_TOTAL_ATTACHMENT_CONTEXT_CHARS - consumed_chars
        if remaining <= 0:
            break
        clipped = block[:remaining]
        sections.append(clipped)
        consumed_chars += len(clipped)
    if not sections:
        return ""
    return "User attached the following files. Use their contents when relevant:\n\n" + "\n\n---\n\n".join(sections)


def extract_urls_from_messages(messages: list[dict[str, Any]]) -> list[str]:
    urls: list[str] = []
    for message in messages:
        content = message.get("content")
        if isinstance(content, str):
            urls.extend(URL_PATTERN.findall(content))
    deduped: list[str] = []
    for url in urls:
        if url not in deduped:
            deduped.append(url)
    return deduped[:4]


def strip_html(html: str) -> str:
    no_script = re.sub(r"<script.*?</script>|<style.*?</style>", " ", html, flags=re.IGNORECASE | re.DOTALL)
    plain = re.sub(r"<[^>]+>", " ", no_script)
    plain = unescape(plain)
    return re.sub(r"\s+", " ", plain).strip()


async def fetch_url_context(urls: list[str]) -> str:
    sections: list[str] = []
    async with httpx.AsyncClient(timeout=httpx.Timeout(15.0), follow_redirects=True) as client:
        for url in urls[:4]:
            parsed = urlparse(url)
            if parsed.scheme not in {"http", "https"}:
                continue
            try:
                response = await client.get(url, headers={"User-Agent": "CodePuppyBot/1.0"})
                response.raise_for_status()
                body = strip_html(response.text)
                if body:
                    sections.append(f"URL: {url}\nContent: {truncate_text(body, 4000)}")
            except Exception as exc:
                sections.append(f"URL: {url}\nContent fetch failed: {exc}")
    return "\n\n---\n\n".join(sections)


async def perform_web_search(query: str) -> dict[str, Any]:
    clean_query = (query or "").strip()
    if not clean_query:
        return {
            "provider": "duckduckgo",
            "query": clean_query,
            "used": False,
            "resultCount": 0,
            "context": "",
            "summary": "Search skipped because the query was empty.",
        }
    async with httpx.AsyncClient(timeout=httpx.Timeout(15.0), follow_redirects=True) as client:
        response = await client.get(
            "https://api.duckduckgo.com/",
            params={"q": clean_query, "format": "json", "no_redirect": 1, "no_html": 1},
            headers={"User-Agent": "CodePuppyBot/1.0"},
        )
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Web search failed: {response.text or response.reason_phrase}")
    data = response.json()
    lines: list[str] = []
    result_count = 0
    abstract = str(data.get("AbstractText") or "").strip()
    if abstract:
        lines.append(f"Abstract: {abstract}")
        result_count += 1
    for item in (data.get("RelatedTopics") or [])[:8]:
        if isinstance(item, dict):
            if item.get("Text") and item.get("FirstURL"):
                lines.append(f"- {item['Text']} ({item['FirstURL']})")
                result_count += 1
            for nested in (item.get("Topics") or [])[:4]:
                if nested.get("Text") and nested.get("FirstURL"):
                    lines.append(f"- {nested['Text']} ({nested['FirstURL']})")
                    result_count += 1
    context = (
        f"Web search results (provider: DuckDuckGo Instant Answer, query: {clean_query}):\n"
        + "\n".join(lines)
        if lines
        else ""
    )
    return {
        "provider": "duckduckgo",
        "query": clean_query,
        "used": bool(context),
        "resultCount": result_count,
        "context": context,
        "summary": (
            f"{result_count} DuckDuckGo search result snippets attached to the prompt for query: {clean_query}."
            if context
            else f"No DuckDuckGo search results were returned for query: {clean_query}."
        ),
    }
