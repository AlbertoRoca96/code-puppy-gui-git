"""Tkinter front end that shells into the code_puppy_gui.worker helper."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
from dataclasses import dataclass
from datetime import datetime
from queue import Empty, Queue
from typing import Optional

import tkinter as tk
from tkinter import messagebox, scrolledtext, ttk


@dataclass
class GuiEvent:
    kind: str
    payload: Optional[str] = None


class PuppyGuiApp:
    POLL_INTERVAL_MS = 80

    def __init__(self) -> None:
        self.root = tk.Tk()
        self.root.title("Code Puppy GUI 🐶")
        self.root.geometry("900x620")
        self.root.minsize(760, 520)

        self.queue: Queue[GuiEvent] = Queue()
        self.worker_thread: Optional[threading.Thread] = None
        self.current_process: Optional[subprocess.Popen[str]] = None
        self.status_var = tk.StringVar(value="Idle")

        self._build_layout()
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self.root.after(self.POLL_INTERVAL_MS, self._drain_queue)

    # ------------------------------------------------------------------ UI ----
    def _build_layout(self) -> None:
        container = ttk.Frame(self.root, padding=12)
        container.pack(fill=tk.BOTH, expand=True)

        ttk.Label(container, text="Enter your coding task:").pack(anchor=tk.W)
        self.prompt_input = tk.Text(container, height=6, wrap=tk.WORD)
        self.prompt_input.pack(fill=tk.X, expand=False)

        buttons = ttk.Frame(container)
        buttons.pack(fill=tk.X, pady=(8, 0))

        self.run_button = ttk.Button(buttons, text="Run task", command=self.run_task)
        self.run_button.pack(side=tk.LEFT)

        self.cancel_button = ttk.Button(
            buttons, text="Cancel", command=self.cancel_task, state=tk.DISABLED
        )
        self.cancel_button.pack(side=tk.LEFT, padx=(8, 0))

        ttk.Button(buttons, text="Clear log", command=self._clear_log).pack(
            side=tk.RIGHT
        )

        ttk.Label(container, text="Puppy output:").pack(anchor=tk.W, pady=(12, 0))

        self.output = scrolledtext.ScrolledText(
            container,
            wrap=tk.WORD,
            height=20,
            state=tk.DISABLED,
            font=("Consolas", 10),
        )
        self.output.pack(fill=tk.BOTH, expand=True)

        status = ttk.Frame(container)
        status.pack(fill=tk.X, pady=(8, 0))
        ttk.Label(status, text="Status:").pack(side=tk.LEFT)
        ttk.Label(status, textvariable=self.status_var).pack(side=tk.LEFT, padx=8)

    # ------------------------------------------------------------ event loop ----
    def run(self) -> None:
        self.root.mainloop()

    def _append_log(self, text: str, prefix: str = "") -> None:
        if not text:
            return
        self.output.configure(state=tk.NORMAL)
        timestamp = datetime.now().strftime("%H:%M:%S")
        line = f"[{timestamp}] {prefix}{text}\n"
        self.output.insert(tk.END, line)
        self.output.see(tk.END)
        self.output.configure(state=tk.DISABLED)

    def _clear_log(self) -> None:
        self.output.configure(state=tk.NORMAL)
        self.output.delete("1.0", tk.END)
        self.output.configure(state=tk.DISABLED)

    # ----------------------------------------------------------- lifecycle ----
    def _on_close(self) -> None:
        if self.worker_thread and self.worker_thread.is_alive():
            if not messagebox.askyesno(
                "Quit?", "A task is running. Cancel it and close the window?"
            ):
                return
            self.cancel_task()
            self.worker_thread.join(timeout=5)
        self.root.destroy()

    # ------------------------------------------------------------- actions ----
    def run_task(self) -> None:
        if self.worker_thread and self.worker_thread.is_alive():
            messagebox.showinfo("Busy", "Let the puppy finish the current task first.")
            return

        prompt = self.prompt_input.get("1.0", tk.END).strip()
        if not prompt:
            messagebox.showwarning("Missing prompt", "Tell the puppy what to do first!")
            return

        self.run_button.configure(state=tk.DISABLED)
        self.cancel_button.configure(state=tk.NORMAL)
        self.status_var.set("Running…")
        self._append_log(prompt, prefix="You → ")

        self.worker_thread = threading.Thread(
            target=self._execute_prompt, args=(prompt,), daemon=True
        )
        self.worker_thread.start()

    def cancel_task(self) -> None:
        if not self.current_process or self.current_process.poll() is not None:
            self.status_var.set("Idle")
            self.cancel_button.configure(state=tk.DISABLED)
            return
        self._append_log("Cancelling task…", prefix="UI → ")
        try:
            self.current_process.terminate()
        except ProcessLookupError:
            pass

    # ----------------------------------------------------------- background ----
    def _execute_prompt(self, prompt: str) -> None:
        cmd = [
            sys.executable,
            "-m",
            "code_puppy_gui.worker",
            "--prompt",
            prompt,
        ]
        env = os.environ.copy()
        env.setdefault("PYTHONIOENCODING", "utf-8")
        try:
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=env,
            )
        except FileNotFoundError as exc:
            self.queue.put(GuiEvent("error", f"Failed to launch worker: {exc}"))
            self.queue.put(GuiEvent("done", "start-error"))
            return

        self.current_process = process

        def pump_stdout() -> None:
            assert process.stdout is not None
            for raw_line in process.stdout:
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                    self._handle_worker_event(event)
                except json.JSONDecodeError:
                    self.queue.put(GuiEvent("bus", line))

        def pump_stderr() -> None:
            assert process.stderr is not None
            for raw_line in process.stderr:
                line = raw_line.rstrip()
                if line:
                    self.queue.put(GuiEvent("stderr", line))

        stdout_thread = threading.Thread(target=pump_stdout, daemon=True)
        stderr_thread = threading.Thread(target=pump_stderr, daemon=True)
        stdout_thread.start()
        stderr_thread.start()

        exit_code = process.wait()
        stdout_thread.join()
        stderr_thread.join()
        self.current_process = None
        self.queue.put(GuiEvent("done", str(exit_code)))

    def _handle_worker_event(self, event: dict[str, str]) -> None:
        kind = event.get("event")
        if kind == "log":
            self.queue.put(GuiEvent("bus", event.get("content", "")))
        elif kind == "agent_response":
            self.queue.put(GuiEvent("agent_response", event.get("content", "")))
        elif kind == "error":
            message = event.get("message") or event.get("content") or "Unknown error"
            self.queue.put(GuiEvent("error", message))
        elif kind == "done":
            self.queue.put(GuiEvent("done", str(event.get("code", ""))))
        else:
            self.queue.put(GuiEvent("bus", json.dumps(event)))

    # -------------------------------------------------------------- queue ----
    def _drain_queue(self) -> None:
        try:
            while True:
                event = self.queue.get_nowait()
                self._handle_gui_event(event)
        except Empty:
            pass
        finally:
            self.root.after(self.POLL_INTERVAL_MS, self._drain_queue)

    def _handle_gui_event(self, event: GuiEvent) -> None:
        if event.kind == "bus":
            self._append_log(event.payload or "")
        elif event.kind == "agent_response":
            self._append_log(event.payload or "", prefix="Agent → ")
        elif event.kind == "info":
            self._append_log(event.payload or "", prefix="info → ")
        elif event.kind == "stderr":
            self._append_log(event.payload or "", prefix="stderr → ")
        elif event.kind == "error":
            self._append_log(event.payload or "", prefix="error → ")
            messagebox.showerror("Code Puppy", event.payload or "Unknown error")
        elif event.kind == "done":
            code = event.payload or "?"
            self._append_log(f"Task finished with exit code {code}")
            self.status_var.set("Idle")
            self.run_button.configure(state=tk.NORMAL)
            self.cancel_button.configure(state=tk.DISABLED)
        else:
            self._append_log(f"Unknown event {event.kind}")


def main() -> None:
    app = PuppyGuiApp()
    app.run()


if __name__ == "__main__":
    main()
