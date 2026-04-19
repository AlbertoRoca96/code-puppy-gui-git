# Release Checklist

## Required secrets

### Backend / Fly.io
- `FLY_API_TOKEN`
- `SYN_API_KEY`
- `OPEN_API_KEY` (if using OpenAI models)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET`

### Expo / Mobile builds
- `EXPO_TOKEN`

### iOS / TestFlight submission
- `EXPO_APPLE_ID`
- `EXPO_APPLE_APP_SPECIFIC_PASSWORD`
- `EXPO_ASC_APP_ID`

## iOS metadata checklist
- Bundle identifier matches App Store Connect app: `com.albertoroca96.codepuppy`
- App icon present and export-safe
- Build number increments (`IOS_BUILD_NUMBER` or EAS auto-increment)
- Privacy strings present for photo library usage
- TestFlight testers configured in App Store Connect
- App privacy nutrition labels completed in App Store Connect
- Support URL / marketing URL / privacy policy URL configured in App Store Connect

## Android release checklist
- Package name matches Play Console app: `com.albertoroca96.codepuppy`
- Version code increments (`ANDROID_VERSION_CODE` or EAS auto-increment)
- Build production **AAB** for Play Store
- Upload signing handled through EAS credentials / Play Console
- Store listing assets ready:
  - app icon
  - feature graphic
  - screenshots
  - privacy policy URL
- Play Console content rating + data safety sections completed

## Pre-release verification
- `python -m pytest -q`
- `python -m compileall backend tests src/code_puppy_gui`
- `cd mobile && npm ci && npm run lint && npm run format && npx tsc --noEmit`
- Verify backend `/api/health`
- Verify login, file upload, photo upload, streaming, search toggle, and session rollover on device

## Reality-based notes
- TestFlight submission still depends on Apple credentials and App Store Connect setup.
- Android Play release still needs Play Console setup and signing credentials.
- CI helps, but it will not spiritually heal missing store metadata. Sad but true.
