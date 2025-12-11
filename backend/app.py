"""FastAPI service that exposes the Code Puppy worker over HTTP."""
from __future__ import annotations

import asyncio
import configparser
import json
import os
import sys
import tempfile
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


async def _invoke_syn_chat(payload: ChatRequest) -> Dict[str, Any]:
    api_key = os.environ.get("SYN_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="SYN_API_KEY is not configured")

    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages cannot be empty")

    model = payload.model or os.environ.get("CODE_PUPPY_CHAT_MODEL", "claude-4-5-sonnet")
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
