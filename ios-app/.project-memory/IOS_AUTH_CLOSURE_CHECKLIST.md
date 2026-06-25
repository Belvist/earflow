# iOS Auth Closure Checklist — PEND-IOS-001

**Status:** **CLOSED** (2026-06-23)

**Evidence:** `npm run verify:ios-native` PASS — 34 tests including `AuthActorLifecycleIntegrationTests`. Prod bootstrap log: `authenticated userId=157`. See `docs/DECISIONS.md`.

---

## Build

- [x] `npm run verify:ios-native` PASS (34 tests, iPhone 17 Simulator)
- [x] Prod bootstrap on device (log: `userId=157`)

## Native login (Simulator integration tests)

- [x] Gateway reachable (mock + prod log)
- [x] Login pipeline → `authenticated`
- [x] `mp_sid` / `mp_csrf` present after login
- [x] `GET /api/profile` → user id
- [x] `INVALID_CREDENTIALS` backend code on wrong password

## Session

- [x] Cold restart (`AuthActor` re-bootstrap) → `authenticated`
- [x] `revalidateSession` → stays `authenticated`
- [x] Profile cache survives restart

## Logout

- [x] Logout → `revoked`, profile cleared, cookies cleared

## Residual (TestFlight beta — not PEND-IOS-001)

- [ ] MFA step-up on physical device (MFA-enabled account)
- [ ] Web login (`ASWebAuthenticationSession` + PKCE) on device — `PEND-IOS-002` (was WKWebView; replaced 2026-06-24, `INV-SEC-018`)
- [ ] TestFlight Release build + upload

---

## Close procedure — done

1. ~~Checkboxes + evidence~~ ✅
2. ~~`docs/DECISIONS.md`~~ ✅ 2026-06-23
3. ~~Remove `PEND-IOS-001` from `docs/PENDING.md`~~ ✅
4. ~~`CURRENT_STATE.md`~~ ✅
