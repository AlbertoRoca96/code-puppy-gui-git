from __future__ import annotations

import asyncio
import configparser
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any, AsyncIterator


def ensure_worker_environment() -> None:
    runtime_root = Path(os.environ.get("CODE_PUPPY_RUNTIME_DIR") or Path(tempfile.gettempdir()) / "code_puppy_runtime")
    xdg_mapping = {
        "XDG_CONFIG_HOME": runtime_root / "config",
        "XDG_DATA_HOME": runtime_root / "data",
        "XDG_CACHE_HOME": runtime_root / "cache",
        "XDG_STATE_HOME": runtime_root / "state",
    }
    for env_name, base_path in xdg_mapping.items():
        os.environ.setdefault(env_name, str(base_path))
        (base_path / "code_puppy").mkdir(parents=True, exist_ok=True)
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


def format_event(line: str) -> dict[str, Any]:
    try:
        payload = json.loads(line)
    except json.JSONDecodeError:
        return {"event": "raw", "content": line}
    event = payload.get("event", "log")
    content = payload.get("content") or payload.get("message") or ""
    return {"event": event, "content": content, **{k: v for k, v in payload.items() if k not in {"event", "content"}}}


async def run_worker(prompt: str) -> dict[str, Any]:
    ensure_worker_environment()
    env = os.environ.copy()
    env.setdefault("PYTHONIOENCODING", "utf-8")
    process = await asyncio.create_subprocess_exec(
        sys.executable, "-m", "code_puppy_gui.worker", "--prompt", prompt,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=env,
    )
    logs: list[dict[str, Any]] = []
    response_text: str | None = None
    assert process.stdout is not None and process.stderr is not None

    async def consume_stdout() -> None:
        nonlocal response_text
        async for raw_line in process.stdout:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            event = format_event(line)
            if event.get("event") == "agent_response":
                response_text = event.get("content")
            logs.append(event)

    async def consume_stderr() -> str:
        chunks: list[str] = []
        async for raw_line in process.stderr:
            chunks.append(raw_line.decode("utf-8", errors="replace"))
        return "".join(chunks)

    stdout_task = asyncio.create_task(consume_stdout())
    stderr_task = asyncio.create_task(consume_stderr())
    exit_code = await process.wait()
    await stdout_task
    stderr_output = await stderr_task
    return {"exitCode": exit_code, "logs": logs, "response": response_text, "stderr": stderr_output}


async def stream_worker(prompt: str) -> AsyncIterator[dict[str, Any]]:
    result = await run_worker(prompt)
    for item in result.get("logs", []):
        yield item
    yield {"event": "done", "content": result.get("response") or "", "exitCode": result.get("exitCode", 1)}
