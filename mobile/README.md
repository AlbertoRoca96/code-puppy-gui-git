# Code Puppy Mobile

Expo app for Android, iOS, and web.

## What works

- Supabase auth
- Chat sessions
- Local + remote session history
- Attachment uploads
- Photo uploads
- Streaming assistant responses
- Optional web-search augmentation
- Empty-session suppression
- Automatic rollover after 200 messages
- Existing empty session cleanup on startup
- Runtime settings for API base override, search toggle, and streaming toggle

## Development

```bash
npm install
npm start
npm run android
npm run ios
```

## Storage model

- Auth tokens: SecureStore / browser localStorage
- Chat session cache: AsyncStorage / browser localStorage

## Important UX fixes

- Android composer stays visible when the keyboard opens
- Tapping outside the composer dismisses the keyboard
- Opening the app on a fresh draft no longer creates junk `New chat / 0 msgs` sessions

## Build

```bash
eas build --platform android --profile preview
eas build --platform ios --profile preview
```

Production store/TestFlight submission is now wired in CI, but still needs the usual EAS/App Store credentials and secrets.

See `../RELEASE_CHECKLIST.md` for the exact secret checklist, iOS metadata requirements, and Android release notes.
See `../QA_CHECKLIST.md` for the manual Android/iOS/device QA pass before release.

## Quality checks

```bash
npm run lint
npm run format
npx tsc --noEmit
```
