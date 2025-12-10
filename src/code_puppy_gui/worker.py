"""Helper process that runs Code Puppy and streams structured logs to stdout."""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import threading
import time
from typing import Any

from code_puppy import callbacks
from code_puppy.agents.agent_manager import get_current_agent
from code_puppy.config import ensure_config_exists, load_api_keys_to_environment
from code_puppy.messaging import (
    AgentReasoningMessage,
    AgentResponseMessage,
    FileListingMessage,
    MessageLevel,
    ShellOutputMessage,
    SpinnerControl,
    TextMessage,
    get_message_bus,
)

_send_lock = threading.Lock()


def _emit(event: str, **payload: Any) -> None:
    message = {"event": event, **payload}
    with _send_lock:
        print(json.dumps(message, ensure_ascii=False), flush=True)


def _format_message(message: object) -> str:
    if isinstance(message, SpinnerControl):
        return ""
    if isinstance(message, AgentReasoningMessage):
        lines = ["AGENT REASONING", message.reasoning]
        if message.next_steps:
            lines.append(f"Next: {message.next_steps}")
        return "\n".join(lines)
    if isinstance(message, AgentResponseMessage):
        return message.content
    if isinstance(message, TextMessage):
        level = message.level.value.upper()
        return f"{level}: {message.text}"
    if isinstance(message, ShellOutputMessage):
        parts = [f"SHELL ({message.command}) exit={message.exit_code}"]
        if message.stdout:
            parts.append(message.stdout)
        if message.stderr:
            parts.append(f"stderr: {message.stderr}")
        return "\n".join(parts)
    if isinstance(message, FileListingMessage):
        return (
            f"LIST {message.directory} -> {message.dir_count} dirs, "
            f"{message.file_count} files"
        )
    return f"{message.__class__.__name__}: {message}"


def _consume_bus(stop_event: threading.Event) -> None:
    bus = get_message_bus()
    bus.mark_renderer_active()
    try:
        buffered = bus.get_buffered_messages()
        bus.clear_buffer()
        for msg in buffered:
            formatted = _format_message(msg)
            if formatted:
                _emit("log", content=formatted)
        while not stop_event.is_set():
            message = bus.get_message_nowait()
            if message is None:
                time.sleep(0.05)
                continue
            formatted = _format_message(message)
            if formatted:
                _emit("log", content=formatted)
    finally:
        bus.mark_renderer_inactive()


def _bootstrap() -> None:
    ensure_config_exists()
    load_api_keys_to_environment()


async def _run_agent(prompt: str) -> int:
    await callbacks.on_startup()
    stop_event = threading.Event()
    consumer = threading.Thread(target=_consume_bus, args=(stop_event,), daemon=True)
    consumer.start()

    exit_code = 0
    try:
        agent = get_current_agent()
        result = await agent.run_with_mcp(prompt)
        if result and getattr(result, "output", None):
            output = result.output.strip()
            if output:
                _emit("agent_response", content=output)
    except asyncio.CancelledError:
        exit_code = 130
        _emit("error", message="Agent run cancelled")
    except Exception as exc:  # pragma: no cover - defensive
        exit_code = 1
        _emit("error", message=str(exc))
    finally:
        stop_event.set()
        consumer.join(timeout=2)
        await callbacks.on_shutdown()
    return exit_code


def main() -> None:
    parser = argparse.ArgumentParser(description="Code Puppy worker helper")
    parser.add_argument("--prompt", required=True, help="Prompt to run")
    args = parser.parse_args()

    _bootstrap()
    exit_code = asyncio.run(_run_agent(args.prompt))
    _emit("done", code=exit_code)
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
