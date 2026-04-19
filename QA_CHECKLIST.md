# Device QA Checklist

## Core chat flow
- Log in successfully
- Start a new chat
- Send a plain text message
- Verify streamed response appears token-by-token
- Tap **Stop streaming** and verify partial response is preserved cleanly
- Disable streaming in settings and verify one-shot response still works

## Attachments
- Upload a small text/code file
- Upload an image from photo library
- Verify upload progress text advances toward 100%
- Verify uploaded attachments appear in the sent message
- Verify attachment fetch fails for non-owner accounts

## Session behavior
- Open app fresh and confirm blank draft is not persisted as chat history
- Send messages until rollover threshold logic is exercised (or lower in dev)
- Verify session list shows synced/local state correctly
- Search sessions by title
- Search sessions by message content
- Delete a session and verify local + remote removal behavior

## Settings/auth
- Change API base override and confirm app reconnects
- Toggle default web search
- Toggle streaming
- Sign out and verify protected calls stop working until sign-in

## iOS specific
- Keyboard does not cover composer
- Photo library permission prompt has sane copy
- TestFlight build launches cleanly on fresh install
- Background/foreground app resume keeps auth state sane

## Android specific
- Back button navigation behaves correctly
- File picker + image picker both work
- Keyboard dismiss and composer visibility feel normal
- Preview/production build installs cleanly

## Release dry run
- Build Android preview/prod artifact with EAS
- Build iOS preview/prod artifact with EAS
- Verify versionCode/buildNumber increments
- Verify icons, splash, permissions, and privacy strings are present
- Confirm store metadata exists before submission so CI is not blamed for your paperwork
