# Testing — Earflow iOS

## Unit tests (`EarflowTests/`)

| Suite | Covers |
|-------|--------|
| `CanonicalProofStringTests` | PoP string = gateway/web |
| `AuthStateTests` | Auth state enum / transitions |

Run:

```bash
cd ios-app
xcodebuild -scheme Earflow -destination 'platform=iOS Simulator,name=iPhone 17' test
# or
npm run verify:ios-native
```

## Build gate

```bash
xcodegen generate
xcodebuild -scheme Earflow -destination 'generic/platform=iOS Simulator' build
```

## Manual smoke (Phase 2)

1. Launch → login screen (dark UI, tabs)
2. Email login against prod/staging account
3. Home loads rails or empty state without crash
4. Search query returns results
5. Social feed loads or empty
6. Tap track → mini player → sheet
7. Settings → debug log shows gateway lines without secrets
8. Logout → back to login

## Not yet required (PEND-IOS-001)

- UI automation (XCUITest)
- Real device gesture matrix
- Device Sync integration tests
- Security pentest

## Test plan template (new feature)

1. Unit: validators, DTO decode, state machine
2. Build: compile all architectures
3. Manual: happy path + error path + offline
4. Regression: auth + playback still work

## CI gap

No GitHub Actions macOS runner yet — local Xcode required.
