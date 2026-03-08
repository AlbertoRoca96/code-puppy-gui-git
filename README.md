# Code Puppy GUI (Web + Desktop)

Live deployment targets:

- **Frontend:** <https://albertoroca96.github.io/code-puppy-gui-git/>
- **Backend (after Fly deploy):** <https://code-puppy-api.fly.dev>

This repo now has **four** pieces that work together:

| Folder | Purpose |
| --- | --- |
| `src/code_puppy_gui` | The original desktop/Tkinter GUI + worker module. |
| `backend/` | FastAPI service that shells into the worker and exposes it over HTTPS. |
| `docs/` | Static React single-page app (served by GitHub Pages) that talks to the backend. |
| `mobile/` | Expo React Native iOS/Android app that talks to the backend. |

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
   - `SUPABASE_URL` – your project URL, e.g. `https://your-project.supabase.co`.
   - `SUPABASE_SERVICE_ROLE_KEY` – **service role key** from Supabase Project Settings → API (do **not** use the publishable/anon key for backend storage writes).
   - `SUPABASE_STORAGE_BUCKET` – the bucket name you create for Code Puppy uploads, e.g. `code-puppy-uploads`.
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

1. **Set up Fly secrets:** `flyctl secrets set SYN_API_KEY=... OPEN_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_STORAGE_BUCKET=...` (or let the GitHub Action do it).
2. **Add GitHub secrets:** `FLY_API_TOKEN` + `SYN_API_KEY` (+ `OPEN_API_KEY` if using OpenAI models) + `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_STORAGE_BUCKET`. **Also add `EXPO_TOKEN`** for mobile builds.
3. **Push to `main`:** the workflow builds + deploys automatically.
4. **Frontend auto-publishes** from `/docs` via GitHub Pages.
5. **Mobile app** builds automatically via GitHub Actions when you push to `main`.
6. **Desktop app** still works through `pip install -e . && code-puppy-gui` if you want a native feel.

### All Deployments

| Deployment | URL | Platform | Status |
|------------|-----|----------|--------|
| Desktop | Local install only | Python | ✅ Works |
| Web | https://albertoroca96.github.io/code-puppy-gui-git/ | GitHub Pages | ✅ Live |
| API Backend | https://code-puppy-api.fly.dev | Fly.io | ✅ Live |
| Mobile iOS | TestFlight (via EAS Build) | iOS App Store | 🔄 Ready to build |
| Mobile Android | APK (via EAS Build) | Play Store | 🔄 Ready to build |

That's it. You now have:

- `code-puppy-gui.exe` for local work
- A FastAPI API for other clients
- A React website on GitHub Pages that can hit that API
- An iOS/Android mobile app built with Expo

All three share the same FastAPI backend for consistent AI responses!

Go make it sassier than every overpriced IDE. 🐶🔥

---

## 4. Mobile App (iOS/Android) 📱

### Local Development

```bash
cd mobile
npm install
npm start
# Press 'i' for iOS simulator, 'a' for Android emulator
```

### Setup EAS (One-time for production builds)

```bash
npm install -g eas-cli
eas login
cd mobile
eas build:configure
```

### GitHub Actions

The `.github/workflows/mobile-build.yml` workflow automatically builds iOS TestFlight and Android APKs whenever you push to `main`.

**Required GitHub Secret:**
- `EXPO_TOKEN` – Get from https://expo.dev/settings/access-tokens

### Build for Production

```bash
cd mobile
eas build --platform ios --profile production   # iOS TestFlight
eas build --platform android --profile production # Android APK/APK Store build

# Submit to App Store
eas submit --platform ios --profile production
```

### Configuration

The mobile app is configured in `mobile/app.config.ts` and connects automatically to:\n- Local dev: `http://localhost:8000`
- Production: `https://code-puppy-api.fly.dev`

You can configure a different endpoint in the mobile Settings screen or by setting environment variables.

### Architecture

```
                GitHub Repo
          code-puppy-gui-git
                 │
      ┌────────────┼────────────┐
      │            │            │
  Desktop      Web         Mobile
  (Python)     (React)    (Expo/ReactNative)
      │            │            │
      └────────────┴────────────┘
                   │
                   ▼
         FastAPI Backend
         code-puppy-api.fly.dev
                   │
                   ▼
            AI Models (Synthetic,
                      OpenAI, etc.)
```

All three frontends share the same backend for consistent behavior!

### Supabase storage note

If you want durable multi-device attachments, create a Supabase Storage bucket (for example `code-puppy-uploads`) and keep it **private**. The backend should use the `SUPABASE_SERVICE_ROLE_KEY` to upload/read files server-side. Do **not** commit Supabase keys into the repo, and do **not** use the publishable key for privileged backend storage operations.

### See Also

- `SETUP_GUIDE.md` - Full setup instructions for all 4 deployments
- `mobile/README.md` - Mobile-specific documentation
