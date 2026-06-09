# Earflow Auth Kit — reusable foundation

**Status:** Level 1 code complete (2026-06-09) — **browser DoD + VPS deploy** required for «fully confident»  
**Gate:** `npm run verify:auth-kit` (automated) + `docs/AUTH_ROLLOUT_GATES.md` (browser)

---

## Честно: что это и чего это НЕ

| Утверждение | Правда |
|-------------|--------|
| «Cookie transplant не даёт API-доступ» | **Да** — PoP + proof token на prod (SEC-001, SEC-013) |
| «Архитектура рассчитана на рост hot-path» | **Да** — proof token вместо ECDSA+Redis SETNX на каждый GET; epoch revoke; PG SoT path |
| «Абсолютно безопасно / нельзя взломать» | **Нет** — XSS на том же origin, malware с ключом, фишинг вне scope PoP |
| «Уровень Telegram/Apple сегодня» | **Нет** — нет passkeys, login alerts, risk engine, WS/stream ENFORCE на prod |
| «Готово копировать в другой проект (API)** | **Да (Level 1)** — после `verify:auth-kit` + browser DoD |
| «Готово копировать transport (stream/WS)** | **Частично** — код есть; prod flags **off**; staging gate обязателен |

---

## Уровни зрелости (Definition of Done)

### Level 1 — API Auth Kit (код готов, prod-safe defaults)

| Компонент | Статус |
|-----------|--------|
| PoP device-bound session | prod |
| Proof Access Token hot path | prod (если `PROOF_ACCESS_TOKEN_ENABLED=1`) |
| `RevokeSessionFull` unified | done |
| PG SoT `dual_write` | VPS |
| Epoch revoke pub/sub | done |
| Sessions revoke / others / all | API + UI |
| Fresh-login 24h guard | `FRESH_LOGIN_REQUIRED` |
| MFA step-up modal (sessions) | listener UI |
| Stream ticket mint (frontend) | code; default off |

**Automated gate:** `npm run verify:auth-kit`  
**Browser gate:** `bash scripts/run-auth-proof-token-browser-dod.sh` (8/8)  
**Full-stack:** `bash scripts/run-auth-fullstack-e2e.sh`

### Level 2 — Transport Auth (staging only, не prod)

| Компонент | Статус |
|-----------|--------|
| Gateway mint | auth-e2e |
| Stream ACCEPT dual-mode | auth-e2e (`verify:stream-ticket-accept`) |
| Frontend `?st=` attach | opt-in `REACT_APP_STREAM_TICKET_MINT_ENABLED=1` |
| Prod ACCEPT / ENFORCE | intentionally off |
| WS connect opaque ticket | Phase 8 |

**Gate:** auth-e2e overlay + `npm run verify:auth-kit -- --with-e2e`

### Level 3 — Operations (будущее)

Passkeys (SEC-006), login alerts (SEC-007), CSP/XSS (SEC-009), risk engine (SEC-008), artist-frontend proof cache, `pg_only` SoT.

---

## Архитектура: стабильность и оптимизация (заложено)

```text
Browser → nginx → go-api-gateway (единственный choke point)
              ├─ Session + PoP / Proof Access Token
              ├─ CSRF (unsafe routes)
              └─ proxy → services (trust X-User-Id only from gateway)

Hot path (95%+ GET):  proof JWT ~90s + local epoch cache — без Redis write/request
Sensitive (refresh, revoke, MFA): full ECDSA + SETNX nonce
Revoke:               PG epoch bump + Redis pub/sub → все gateway replicas ≤2s
Stream bytes:         scoped ticket OR legacy (dual-mode); ENFORCE — отдельная фаза
```

**Красные флаги в архитектуре (запрещены):** `epochs/lookup` per segment; JWT in query; ticket in localStorage; `ALLOW_COOKIE_AUTH_WITHOUT_PROOF` on prod.

**Известный trade-off (принят):** proof token replay ~90s при XSS — см. SEC-013; лечится CSP (Level 3).

---

## Environment

### Prod VPS — ничего нового включать не нужно

Оставить пустым / `0`:

```bash
STREAM_TICKET_ENABLED=
STREAM_TICKET_ACCEPT=
EARFLOW_API_BASE_URL=          # empty
```

Опционально уже на VPS:

```bash
AUTH_PG_SOT_MODE=dual_write
PROOF_ACCESS_TOKEN_ENABLED=1   # api-gateway
```

Frontend build-time (default в коде = безопасно):

```bash
REACT_APP_STREAM_TICKET_MINT_ENABLED=0   # не менять на prod без staging
```

### Auth-e2e only

Overlay `docker-compose.auth-e2e.yml` + rebuild frontend with `REACT_APP_STREAM_TICKET_MINT_ENABLED=1`.  
После тестов: `bash scripts/restore-prod-after-auth-e2e.sh`

---

## Модули для копирования в другой проект

| Layer | Path |
|-------|------|
| Gateway auth | `backend/go-api-gateway/internal/auth/` |
| Security sessions | `backend/security-service/internal/httpapi/` |
| MFA step-up | `backend/auth-service/lib/mfa/httpRoutes.js` |
| Listener client | `frontend/src/auth/authDeviceCrypto.js`, `proofAccessToken.js`, `streamTicket.js`, `mfaStepUp.js` |
| Verification | `scripts/verify-auth-kit.sh`, `verify-prod-auth-gate.sh`, `run-auth-proof-token-browser-dod.sh` |

---

## VPS deploy checklist (после git pull)

```bash
git pull origin main
docker compose build security-service frontend api-gateway
docker compose up -d security-service frontend api-gateway
npm run verify:auth-kit
bash scripts/verify-prod-auth-gate.sh
# manual: run-auth-proof-token-browser-dod.sh if not run recently
```

**`.env` на prod не трогать**, если restore уже показывал пустые `STREAM_TICKET_*`.

---

## API errors (contract)

`DEVICE_PROOF_REQUIRED`, `MFA_STEP_UP_REQUIRED`, `FRESH_LOGIN_REQUIRED`, `STREAM_TICKET_INVALID` (when ACCEPT on).

---

## Honest limits

PoP **не** останавливает XSS на том же origin — нужен CSP (`SEC-009`).  
Украденные cookies **и** private key — вне модели PoP; нужны alerts + passkeys.  
«Миллионы пользователей» — только capacity report на auth-e2e profile (500 RPS), не весь prod traffic.
