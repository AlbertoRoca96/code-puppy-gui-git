# Code Puppy GUI (Web + Desktop)

This repo now has **three** pieces that work together:

| Folder | Purpose |
| --- | --- |
| `src/code_puppy_gui` | The original desktop/Tkinter GUI + worker module. |
| `backend/` | FastAPI service that shells into the worker and exposes it over HTTPS. |
| `docs/` | Static React single-page app (served by GitHub Pages) that talks to the backend. |

The idea: deploy the backend somewhere cheap (Render, Railway, Fly.io, etc.), expose it over HTTPS, then point the GitHub Pages UI at that endpoint. Boom – a Code Puppy that runs in the browser.

---

## 1. Desktop CLI / Worker

Still works the same way as before:

```bash
pip install -e .
code-puppy-gui
```

The worker is invoked with:

```bash
python -m code_puppy_gui.worker --prompt "whatever"
```

It prints newline-delimited JSON so both the Tk UI **and** the FastAPI backend can parse the results.

---

## 2. Backend (FastAPI)

### Install deps

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt -e ..  # installs code_puppy_gui from parent
```

### Environment variables

- `SYN_API_KEY` – optional key you provided (`syn_4dacf751fbae3e83d51a0fb9682379cc`). Export it before launching so downstream tools can use it.
- `PYTHONIOENCODING` is forced to UTF-8 automatically.

### Run locally

```bash
uvicorn backend.app:app --reload --port 8000
```

Endpoints:

- `GET /api/health` → `{ "status": "ok" }`
- `POST /api/run` → `{ exitCode, logs, response, stderr }`

Each call spawns `python -m code_puppy_gui.worker` behind the scenes and streams its output.

Deploy this anywhere FastAPI is supported. Remember to provision the `SYN_API_KEY` (or any other provider keys) as secrets on the host.

---

## 3. Frontend (React via GitHub Pages)

The Pages configuration points to `/docs`, so whatever lives there is instantly deployed at:

```
https://albertoroca96.github.io/code-puppy-gui-git/
```

`docs/index.html` is a single-file React app loaded via ESM imports. No build step required. Features:

- Prompt textarea
- Adjustable API base URL (defaults to `http://localhost:8000` for local dev)
- Live log feed + exit code display
- Error banner with human-friendly feedback

To point it at your hosted backend, set `window.CODE_PUPPY_API_BASE` before the script runs, or just type the URL into the UI field.

### Optional: customize the landing page

- Update styles directly in `docs/index.html`.
- If you prefer a full Vite/Next.js stack later, replace the contents of `docs/` with your build artifacts and keep Pages pointing at the same folder.

---

## Deployment checklist

1. **Backend** – deploy `backend/app.py` (with `SYN_API_KEY` secret).
2. **Frontend** – push changes to `docs/index.html` (Pages redeploys automatically).
3. **Desktop** (optional) – keep shipping `code-puppy-gui` via `pip install -e .` if you still want the Tk UI.

That’s it. You now have:

- `code-puppy-gui.exe` for local work
- A FastAPI API for other clients
- A React website on GitHub Pages that can hit that API

Go make it sassier than every overpriced IDE. 🐶🔥
