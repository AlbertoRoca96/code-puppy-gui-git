# Code Puppy GUI (Web + Desktop)

Live deployment targets:

- **Frontend:** <https://albertoroca96.github.io/code-puppy-gui-git/>
- **Backend (after Fly deploy):** <https://code-puppy-api.fly.dev>

This repo now has **three** pieces that work together:

| Folder | Purpose |
| --- | --- |
| `src/code_puppy_gui` | The original desktop/Tkinter GUI + worker module. |
| `backend/` | FastAPI service that shells into the worker and exposes it over HTTPS. |
| `docs/` | Static React single-page app (served by GitHub Pages) that talks to the backend. |

The idea: deploy the backend once (we picked **Fly.io**), expose it over HTTPS, then point the GitHub Pages UI at that endpoint. Boom – a Code Puppy that runs in the browser without your laptop being online.

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

### Local dev

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt -e ..
uvicorn backend.app:app --reload --port 8000
```

Set `SYN_API_KEY=syn_4dacf751fbae3e83d51a0fb9682379cc` (or whatever providers you use) before running so the worker has it.

### Production (Fly.io)

We ship a full container build + GitHub Actions pipeline:

| File | Purpose |
| --- | --- |
| `backend/Dockerfile` | Builds the FastAPI app + worker. |
| `fly.toml` | Fly app config (`code-puppy-api`). |
| `.github/workflows/deploy-backend.yml` | CI/CD pipeline. |

**How to enable it:**

1. Install the [Fly CLI](https://fly.io/docs/hands-on/install-flyctl/), run `fly launch --copy-config --no-deploy` if you want to rename the app.
2. In GitHub repo settings → *Secrets and variables → Actions*, add:
   - `FLY_API_TOKEN` – personal access token from `fly auth token`.
   - `SYN_API_KEY` – Synthetic key for `hf:*` models.
   - `OPEN_API_KEY` – OpenAI key if you want to use `openai:*` models.
3. Push to `main`. The workflow will:
   - run a quick smoke test,
   - push the container,
   - set `SYN_API_KEY` on Fly,
   - and deploy to `https://code-puppy-api.fly.dev` (or whatever app name you picked).

Endpoints:

- `GET /api/health` → `{ "status": "ok" }`
- `POST /api/chat` → proxies to Synthetic for `hf:*` models (requires `SYN_API_KEY`) or OpenAI for `openai:*` models (requires `OPEN_API_KEY`).
- `POST /api/run` → `{ exitCode, logs, response, stderr }` for the legacy worker shell-out.

### Session persistence

- Session snapshots now live under `~/.code_puppy/sessions` (or `%LOCALAPPDATA%\CodePuppy\sessions` on Windows) so they survive browser + OS restarts.
- Override the location with `CODE_PUPPY_SESSION_DIR=/some/other/path` if you mount a Fly volume or want to stash them elsewhere.
- On first boot we automatically copy any legacy `/tmp/code_puppy_sessions` files into the new directory so you don’t lose yesterday’s chats.

Each `api/run` call spawns `python -m code_puppy_gui.worker`, while `api/chat` simply relays to the SYN-hosted model of your choice. Deploy this anywhere FastAPI is supported. Remember to provision `SYN_API_KEY` and/or `OPEN_API_KEY` as secrets on the host.

---

## 3. Frontend (React via GitHub Pages)

GitHub Pages serves `docs/` directly → <https://albertoroca96.github.io/code-puppy-gui-git/>. The single-file React UI pulls React 18 from ESM and speaks to the backend over HTTPS.

Features:
- Chat-style conversation history with Shift+Enter support.
- Model presets (SYN Claude, OpenAI GPT-5.1, Zai GLM) that map directly to `/api/chat` models, plus an editable system prompt per session.
- Adjustable API base URL (defaults to `https://code-puppy-api.fly.dev`).
- Diagnostics drawer that shows the exact payload + SYN usage the backend returns.
- Root-level `index.html` that redirects to `/docs/` so GitHub Pages works whether it’s configured for `/` or `/docs`.

You can still override the API endpoint at runtime by editing the input field or by setting `window.CODE_PUPPY_API_BASE` before the script runs. If Pages ever shows the README instead of the app, double-check **Settings → Pages** is set to deploy from **main** (either `/` or `/docs` — both now funnel to the chat UI).

### Optional: customize the landing page

- Update styles directly in `docs/index.html`.
- If you prefer a full Vite/Next.js stack later, replace the contents of `docs/` with your build artifacts and keep Pages pointing at the same folder.

---

## Deployment checklist

1. **Set up Fly secrets:** `flyctl secrets set SYN_API_KEY=... OPEN_API_KEY=...` (or let the GitHub Action do it).
2. **Add GitHub secrets:** `FLY_API_TOKEN` + `SYN_API_KEY` (+ `OPEN_API_KEY` if using OpenAI models).
3. **Push to `main`:** the workflow builds + deploys automatically.
4. **Frontend auto-publishes** from `/docs` via GitHub Pages.
5. **Desktop app** still works through `pip install -e . && code-puppy-gui` if you want a native feel.

That’s it. You now have:

- `code-puppy-gui.exe` for local work
- A FastAPI API for other clients
- A React website on GitHub Pages that can hit that API

Go make it sassier than every overpriced IDE. 🐶🔥
