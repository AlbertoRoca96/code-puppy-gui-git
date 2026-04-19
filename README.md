# Code Puppy GUI

Code Puppy is a cross-platform AI chat client for desktop, web, and mobile.

## What this repo includes

| Folder | Purpose |
| --- | --- |
| `src/code_puppy_gui` | Legacy desktop Tkinter shell around the Code Puppy worker |
| `backend/` | FastAPI backend for chat, uploads, sessions, streaming, OCR, and URL/web context |
| `mobile/` | Expo app for iOS, Android, and web |
| `docs/` | Exported static web build published to GitHub Pages |
| `tests/` | Backend tests |

## Current capabilities

- Authenticated chat with Supabase-backed user sessions
- Local desktop worker execution via `/api/run`
- OpenAI-compatible chat via `/api/chat`
- Streaming chat via `/api/chat/stream`
- File uploads with authenticated access controls
- PDF, DOCX, CSV, text, code-file extraction
- OCR for image attachments with `pytesseract`
- Vision attachments for supported OpenAI models
- URL ingestion from prompts
- Optional web-search augmentation from the mobile app
- Session persistence with empty-chat suppression
- Session search by title or message content
- Attachment upload progress in the mobile UI
- Auto-rollover to a fresh session after 200 messages
- Expo Android/iOS/web app builds
- ESLint + Prettier mobile quality checks
- CI backend test gate before deploy

## Important behavior changes

### Empty sessions are no longer saved
Opening the app starts on a fresh draft, but that draft is **not persisted** until the chat contains meaningful content.

### Message cap
Chats roll over to a new session after **200 messages** so older conversations are preserved instead of being silently clobbered.

### Upload privacy
Attachment metadata and content endpoints now require authenticated ownership checks when Supabase auth is enabled.

## Backend endpoints

- `GET /api/health`
- `POST /api/chat`
- `POST /api/chat/stream`
- `POST /api/run`
- `POST /api/uploads`
- `GET /api/upload/{upload_id}`
- `GET /api/upload/{upload_id}/content`
- `GET /api/session/{session_id}`
- `PUT /api/session/{session_id}`
- `DELETE /api/session/{session_id}`
- `GET /api/sessions`
- `GET /api/me`

## Local backend dev

```bash
python -m compileall backend src/code_puppy_gui
uvicorn backend.app:app --reload --port 8000
```

### Local backend test env that actually works

If your global Python install is being weird on Windows, create and use the repo venv:

```bash
uv venv .venv
.venv\\Scripts\\python.exe -m ensurepip --upgrade
.venv\\Scripts\\pip3.exe install -r backend\\requirements.txt
set PYTHONPATH=%CD%
.venv\\Scripts\\python.exe -m pytest -q
```

Environment variables you will typically want:

- `SYN_API_KEY`
- `OPEN_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET`

## Mobile dev

```bash
cd mobile
npm install
npm start
```

### Mobile notes

- Uses Expo Router
- Uses SecureStore for auth tokens
- Uses AsyncStorage/localStorage for chat/session persistence
- Android keyboard handling was updated so the composer stays visible and dismisses when tapping outside it
- Settings screen now supports API base override, default web-search toggle, and streaming toggle
- Existing empty local sessions are cleaned up once on app startup

## Web deploy

The GitHub Action in `.github/workflows/deploy-web.yml` exports the Expo web app and publishes it into `docs/`.

## Mobile build status

- Android EAS preview build: configured
- iOS EAS preview build: configured
- iOS production build + optional submit workflow: configured
- TestFlight submission still requires `EXPO_TOKEN`, `EXPO_APPLE_ID`, `EXPO_APPLE_APP_SPECIFIC_PASSWORD`, and `EXPO_ASC_APP_ID` secrets because Apple remains Apple
- See `RELEASE_CHECKLIST.md` for the full release and store-metadata checklist

## Tests

Backend tests live in `tests/`.
Mobile linting and formatting checks live in CI.

```bash
python -m pytest -q
```

## Architecture notes

The backend was split into smaller modules so `backend/app.py` is now routing/glue instead of a 1300-line kitchen sink:

- `backend/auth_service.py`
- `backend/session_service.py`
- `backend/upload_service.py`
- `backend/attachments_service.py`
- `backend/provider_service.py`
- `backend/worker_service.py`

## Deployment workflows

- `.github/workflows/deploy-backend.yml`
- `.github/workflows/deploy-web.yml`
- `.github/workflows/mobile-build.yml`

## Release checklist

See `RELEASE_CHECKLIST.md` for secrets, TestFlight readiness, Android Play notes, and pre-release verification.
See `QA_CHECKLIST.md` for device-level verification before release.
See `MOBILE_RELEASE_DRY_RUN.md` for EAS dry-run commands/workflow usage.
See `STORE_ASSETS_CHECKLIST.md` for the app-store paperwork humanity forgot to automate.
See `NEXT_STEPS_ON_YOUR_MACHINE.md` for the exact local validation/run/build order.

## Repo truth serum

This repo now supports:
- authenticated uploads
- session filtering to avoid empty-chat spam
- OCR
- streaming responses
- URL ingestion
- optional web-search augmentation

And yes, the mobile README was previously lying about several TODOs. That nonsense has been corrected.
