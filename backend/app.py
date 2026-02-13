"""FastAPI service that exposes the Code Puppy worker over HTTP."""
from __future__ import annotations

import asyncio
import configparser
import json
import os
import re
import shutil
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Code Puppy API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


class RunRequest(BaseModel):
    prompt: str


class ChatRequest(BaseModel):
    messages: List[Dict[str, str]]
    systemPrompt: str | None = None
    model: str | None = None
    temperature: float | None = None


class SessionSnapshot(BaseModel):
    messages: List[Dict[str, str]] = []
    composer: str | None = ""
    presetId: str | None = None
    systemPrompt: str | None = None
    apiBase: str | None = None
    updatedAt: float | None = None

    class Config:
        extra = "allow"


_SESSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


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
_migrate_legacy_sessions(_SESSION_DIR)


_WORKER_ENV_READY = False


def _ensure_worker_environment() -> None:
    """Seed XDG directories + puppy.cfg so the worker never prompts for input."""
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
    """Parse a line emitted by the worker into a structured object."""
    try:
        payload = json.loads(line)
    except json.JSONDecodeError:
        return {"event": "raw", "content": line}

    event = payload.get("event", "log")
    content = payload.get("content") or payload.get("message") or ""
    return {"event": event, "content": content, **{k: v for k, v in payload.items() if k not in {"event", "content"}}}


def _session_file(session_id: str) -> Path:
    if not _SESSION_ID_PATTERN.fullmatch(session_id):
        raise HTTPException(status_code=400, detail="Invalid session id")
    return _SESSION_DIR / f"{session_id}.json"


def _sanitize_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    cleaned: List[Dict[str, str]] = []
    if not messages:
        return cleaned
    for item in messages[-200:]:
        role = item.get("role")
        content = item.get("content")
        if not role or content is None:
            continue
        cleaned.append({"role": str(role)[:32], "content": str(content)})
    return cleaned


def _derive_title(payload: Dict[str, Any]) -> str:
    title = str(payload.get("title") or "").strip()
    if title:
        return title[:120]
    for message in payload.get("messages") or []:
        if message.get("role") == "user":
            content = (message.get("content") or "").strip()
            if content:
                return content[:120]
    return "New chat"


async def _invoke_syn_chat(payload: ChatRequest) -> Dict[str, Any]:
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages cannot be empty")

    model = payload.model or os.environ.get(
        "CODE_PUPPY_CHAT_MODEL", "hf:zai-org/GLM-4.7"
    )

    is_openai = model.startswith("openai:")
    if is_openai:
        api_key = os.environ.get("OPEN_API_KEY") or os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise HTTPException(status_code=503, detail="OPEN_API_KEY is not configured")
        model = model.replace("openai:", "", 1)
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

    chat_messages: List[Dict[str, str]] = []
    if payload.systemPrompt:
        chat_messages.append({"role": "system", "content": payload.systemPrompt})
    for message in payload.messages:
        role = message.get("role")
        content = message.get("content")
        if not role or content is None:
            continue
        chat_messages.append({"role": role, "content": content})

    if not chat_messages:
        raise HTTPException(status_code=400, detail="messages missing content")

    request_body: Dict[str, Any] = {
        "model": model,
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
        except httpx.HTTPStatusError as exc:  # pragma: no cover - network reliant
            detail = exc.response.text or exc.response.reason_phrase
            raise HTTPException(status_code=exc.response.status_code, detail=detail) from exc
        except httpx.RequestError as exc:  # pragma: no cover - network reliant
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    data = response.json()
    choices = data.get("choices") or []
    message_text = ""
    if choices:
        message_text = (
            choices[0]
            .get("message", {})
            .get("content", "")
        )
    return {
        "message": message_text,
        "raw": data,
        "usage": data.get("usage", {}),
        "model": model,
    }


async def _run_worker(prompt: str) -> Dict[str, Any]:
    _ensure_worker_environment()

    env = os.environ.copy()
    env.setdefault("PYTHONIOENCODING", "utf-8")
    # expose SYN key if present so the worker or downstream tools can use it
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


@app.get("/api/session/{session_id}")
async def load_session(session_id: str) -> Dict[str, Any]:
    path = _session_file(session_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Session not found")
    try:
        with path.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
    except json.JSONDecodeError as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail="Session file is corrupted") from exc
    data.setdefault("sessionId", session_id)
    data.setdefault("title", _derive_title(data))
    return data


@app.get("/api/sessions")
async def list_sessions(limit: int = 50) -> Dict[str, Any]:
    max_items = max(1, min(limit, 100))
    entries: List[Dict[str, Any]] = []
    files = sorted(_SESSION_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    for path in files[:max_items]:
        try:
            with path.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (json.JSONDecodeError, OSError):  # pragma: no cover - defensive
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
async def save_session(session_id: str, snapshot: SessionSnapshot) -> Dict[str, Any]:
    path = _session_file(session_id)
    payload = snapshot.model_dump()
    payload["sessionId"] = session_id
    payload["updatedAt"] = snapshot.updatedAt or time.time()
    payload["messages"] = _sanitize_messages(payload.get("messages") or [])
    payload["title"] = _derive_title(payload)

    tmp_path = path.with_suffix(".tmp")
    tmp_path.parent.mkdir(parents=True, exist_ok=True)
    with tmp_path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)
    tmp_path.replace(path)
    return {"status": "saved", "updatedAt": payload["updatedAt"]}


@app.get("/api/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/api/chat")
async def chat(payload: ChatRequest) -> Dict[str, Any]:
    return await _invoke_syn_chat(payload)


@app.post("/api/run")
async def run_prompt(payload: RunRequest) -> Dict[str, Any]:
    if not payload.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt cannot be empty")

    try:
        result = await _run_worker(payload.prompt)
    except FileNotFoundError as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return result


__all__ = ["app"]
