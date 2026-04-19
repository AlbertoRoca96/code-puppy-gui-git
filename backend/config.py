from __future__ import annotations

import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

ALLOWED_CORS_ORIGINS = [
    "https://albertoroca96.github.io",
    "http://localhost:8081",
    "http://localhost:19006",
    "http://127.0.0.1:8081",
    "http://127.0.0.1:19006",
]
ATTACHMENT_TEXT_EXTENSIONS = {
    ".txt", ".md", ".markdown", ".json", ".js", ".ts", ".tsx", ".jsx",
    ".py", ".java", ".kt", ".swift", ".rb", ".go", ".rs", ".php",
    ".html", ".css", ".scss", ".xml", ".yaml", ".yml", ".toml", ".ini",
    ".cfg", ".sql", ".sh", ".bat", ".ps1", ".csv", ".log",
}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}
OPENAI_VISION_MODELS = (
    "gpt-5.2", "gpt-4.1", "gpt-4o", "gpt-4o-mini", "gpt-4.1-mini"
)
MAX_ATTACHMENT_BYTES = 8_000_000
MAX_ATTACHMENT_TEXT_CHARS = 12_000
MAX_TOTAL_ATTACHMENT_CONTEXT_CHARS = 24_000
MAX_CSV_PREVIEW_ROWS = 12
MAX_CSV_PREVIEW_COLS = 8
MAX_DOCX_PARAGRAPHS = 80
MAX_IMAGE_OCR_CHARS = 6000
MAX_MESSAGES_PER_SESSION = 200
SESSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
UPLOAD_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_STORAGE_BUCKET = os.environ.get("SUPABASE_STORAGE_BUCKET", "")
SUPABASE_ENABLED = bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY and SUPABASE_STORAGE_BUCKET)
SUPABASE_DB_ENABLED = bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)


def legacy_session_dir() -> Path:
    return Path(tempfile.gettempdir()) / "code_puppy_sessions"


def resolve_session_dir() -> Path:
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

    candidates.append(legacy_session_dir())
    for candidate in candidates:
        try:
            candidate.mkdir(parents=True, exist_ok=True)
            return candidate
        except OSError:
            continue

    fallback = legacy_session_dir()
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


def resolve_upload_dir(session_dir: Path) -> Path:
    override = os.environ.get("CODE_PUPPY_UPLOAD_DIR")
    if override:
        path = Path(override)
        path.mkdir(parents=True, exist_ok=True)
        return path

    upload_dir = session_dir.parent / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    return upload_dir


def migrate_legacy_sessions(target_dir: Path) -> None:
    old_dir = legacy_session_dir()
    if not old_dir.exists():
        return
    try:
        if old_dir.resolve() == target_dir.resolve():
            return
    except OSError:
        pass
    for source in old_dir.glob("*.json"):
        destination = target_dir / source.name
        if destination.exists():
            continue
        try:
            shutil.copy2(source, destination)
        except OSError:
            continue


SESSION_DIR = resolve_session_dir()
UPLOAD_DIR = resolve_upload_dir(SESSION_DIR)
migrate_legacy_sessions(SESSION_DIR)
