# Mobile Release Dry Run

## Local dry-run commands

From `mobile/`:

```bash
npm ci
npm run lint
npm run format
npx tsc --noEmit
npm run eas:build:ios:preview
npm run eas:build:android:preview
npm run eas:build:ios:production
npm run eas:build:android:production
```

Optional iOS submit dry run after production build is available:

```bash
npm run eas:submit:ios:production
```

## Required env / secrets
- `EXPO_TOKEN`
- `EXPO_APPLE_ID`
- `EXPO_APPLE_APP_SPECIFIC_PASSWORD`
- `EXPO_ASC_APP_ID`

## Workflow sanity
- `mobile-build.yml` always runs quality gates first
- preview builds run for iOS + Android on non-PR pushes
- manual dispatch can be used for production build verification
- iOS submit remains gated on required Apple secrets existing

## Before pressing the big red button
- incremented versions are visible in EAS metadata
- icons/splash look correct
- privacy strings exist
- screenshots/store copy are ready
- backend points at the right production API
