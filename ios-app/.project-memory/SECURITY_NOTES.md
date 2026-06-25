# Security Notes — Earflow iOS

## Auth storage

| Asset | Storage | Lifetime |
|-------|---------|----------|
| P-256 private key | Keychain | Until logout / reinstall |
| authDeviceId, sidHash | Keychain | With key |
| Session cookies | URLSession httpOnly jar | Server TTL |
| Proof access token | RAM | ~90s |

## Transport

- ATS: no arbitrary loads (`INFOPLIST_KEY_NSAppTransportSecurity_NSAllowsArbitraryLoads: NO`)
- Prod: HTTPS to `api.earflow.ru` only
- Debug: `EARFLOW_API_BASE_URL` override for local gateway

## Threat mitigations

| Threat | Mitigation |
|--------|------------|
| Token theft from logs | LogRedactor + EarflowLog policy |
| Login 401 with wrong password | Must **not** call `clearSession` — `skipAuth` on login/register |
| Session TTL | `POST /api/auth/refresh` on 401 before logout (GatewayClient retry) |
| Native Origin / CSRF | `Origin: https://earflow.ru` + `X-Earflow-Client: ios-native` on all gateway requests |
| MITM | TLS + pinned host allowlist in GatewayClient |
| Client spoofed userId | Not sent; session from cookies |
| Direct media URL bypass | HLS session via gateway only |
| Telegram widget XSS | Bot username whitelist regex; WKWebView baseURL earflow.ru |

## PoP alignment

Same canonical proof string as web/gateway — unit tested.

Sensitive routes: full ECDSA when proof token insufficient.

## Audit checklist (pre-release)

- [ ] No secrets in git / plist
- [ ] Debug log export reviewed for redaction
- [ ] Logout clears Keychain + cookies + proof cache
- [ ] 401/403 stops playback (`revoked`)
- [ ] `earflow-security-audit` skill pass for auth changes

## Related

- `docs/AUTH_TARGET_ARCHITECTURE.md`
- `INV-SEC-010`, `INV-SEC-017`
- `universal_project_agent_pack/.project-memory/SECURITY_NOTES.md` (template)
