# Next Steps on Your Machine

## 1) Review the exact working tree
From repo root:

```bash
git status
git diff --stat
```

Recommended sanity review targets:
- `backend/`
- `tests/`
- `mobile/app/`
- `mobile/src/`
- `.github/workflows/`
- release docs in repo root

## 2) Re-run the validated checks
### Backend
```bash
uv venv .venv
.venv\Scripts\python.exe -m ensurepip --upgrade
.venv\Scripts\pip3.exe install -r backend\requirements.txt
set PYTHONPATH=%CD%
.venv\Scripts\python.exe -m pytest -q
python -m compileall backend tests
```

### Mobile
```bash
cd mobile
npm ci
npm run format
npm run lint
npx tsc --noEmit
```

## 3) Run the app locally
### Backend API
```bash
uvicorn backend.app:app --reload --port 8000
```

### Mobile app
In another terminal:
```bash
cd mobile
npm start
```

Then use Expo to launch:
- Android emulator/device
- iOS simulator/device
- web preview if you want a quick smoke check

## 4) Manually verify the important flows
Use:
- `QA_CHECKLIST.md`
- `RELEASE_CHECKLIST.md`
- `MOBILE_RELEASE_DRY_RUN.md`
- `STORE_ASSETS_CHECKLIST.md`

Highest-priority manual checks:
- login works
- chat send works
- streaming works
- stop streaming works
- file/image upload works
- upload progress updates
- session search works
- session delete works
- settings persist

## 5) If you want preview builds
From `mobile/`:
```bash
npm run eas:build:ios:preview
npm run eas:build:android:preview
```

## 6) If you want production build dry runs
From `mobile/`:
```bash
npm run eas:build:ios:production
npm run eas:build:android:production
```

Optional iOS submit:
```bash
npm run eas:submit:ios:production
```

Needed secrets/accounts:
- `EXPO_TOKEN`
- `EXPO_APPLE_ID`
- `EXPO_APPLE_APP_SPECIFIC_PASSWORD`
- `EXPO_ASC_APP_ID`

## 7) Before committing
Recommended commit grouping:
1. backend modularization + tests
2. mobile UX/session/search/upload improvements
3. CI/workflows/release docs

Then:
```bash
git add .
git commit -m "Ship backend/mobile reliability and release tooling improvements"
```

## 8) Before pushing to main
Make sure these are true:
- pytest passes locally
- mobile lint/typecheck passes locally
- manual QA pass is done
- release metadata/docs are ready
- you are not rage-deploying at 2 AM

That last one is optional, but strongly recommended.
