"""FastAPI service that exposes the Code Puppy worker over HTTP."""
from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any, Dict, List

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


def _format_event(line: str) -> Dict[str, Any]:
    """Parse a line emitted by the worker into a structured object."""
    try:
        payload = json.loads(line)
    except json.JSONDecodeError:
        return {"event": "raw", "content": line}

    event = payload.get("event", "log")
    content = payload.get("content") or payload.get("message") or ""
    return {"event": event, "content": content, **{k: v for k, v in payload.items() if k not in {"event", "content"}}}


async def _run_worker(prompt: str) -> Dict[str, Any]:
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
