# State Machines — Earflow iOS

Every important client process has **one owner actor** and explicit states. Direct mutation from Views is forbidden.

---

## Auth — owner: `AuthActor`

### States (`AuthState`)

`unknown` · `unauthenticated` · `authenticating` · `authenticated` · `refreshing` · `expired` · `revoked` · `error`

### Events

| Event | From → To | Guard | Side effects |
|-------|-----------|-------|--------------|
| `bootstrap` | unknown → authenticated / unauthenticated | cookies in jar | load profile, maybe device register |
| `login_submit` | * → authenticating → authenticated | valid credentials | cookies, device register, profile |
| `register_submit` | * → authenticating → authenticated | backend validation | same as login |
| `telegram_auth` | * → authenticating → authenticated | valid Telegram hash | same as login |
| `logout` | authenticated → unauthenticated | — | clear Keychain subset, cookies, proof cache |
| `session_refresh` | authenticated → authenticated | valid mp_sid | POST /api/auth/refresh, renew cookies |
| `unauthorized_401` | authenticated → expired | refresh failed | clear session |
| `device_revoked_403` | * → revoked | code DEVICE_REVOKED | stop playback hook |

### Invariants

- No JWT in UserDefaults.
- Proof access token never persisted.
- Session cookies only from URLSession jar.

---

## Playback — owner: `PlaybackActor`

### States (`PlaybackState`)

`idle` · `loadingSession` · `loadingMedia` · `ready` · `playing` · `paused` · `buffering` · `seeking` · `ended` · `failed` · `revoked`

### Events

| Event | Transition | Side effects |
|-------|------------|--------------|
| `play(trackId)` | idle/failed → loadingSession → … → playing | POST HLS session, AVPlayer load |
| `pause` | playing → paused | AVPlayer pause |
| `resume` | paused → playing | AVPlayer play |
| `stop` | * → idle | tear down player |
| `auth_revoked` | * → revoked | stop, clear session ref |

### Invariants

- One serialized `play` task; coalesced stream session per trackId.
- No direct MinIO URLs.
- UI reads state via `PlaybackCoordinator` stream — does not own AVPlayer.

---

## Device Sync — owner: `DeviceSyncActor` (skeleton)

### States (`DeviceSyncState`)

`localOnly` · `syncing` · `synced` · `conflict` · `serverOverride` · `failed`

### Planned events

`ws_connect` · `frame_received` · `cmd_play_intent` · `disconnect` · `ticket_revoked`

### Invariants (`INV-DS-*`)

- No optimistic `isActive` / ownership on client.
- No REST polling for now-playing.
- WS after register only.

---

## Network — owner: `GatewayClient`

Stateless per request; errors map to `GatewayError` enum. Retry only on 5xx with bounded backoff.

---

## UI shell — `RootView`

Projects `AuthState` from `AuthActor.stateStream()` — no parallel auth flag in View.
