---
name: earflow-device-sync
description: Implements and tests Earflow Device Sync — multi-device playback control, device-sync-service API, frontend DeviceSyncContext and DevicesPanel. Use when working on device-sync-service, DeviceSync components, device sync WebSocket/state, or scripts/device-sync-*.
---

# Earflow Device Sync

## Components

| Layer | Path |
|-------|------|
| Service | `backend/device-sync-service/` |
| Gateway route | `backend/go-api-gateway/gateway.yaml` → `device_sync` upstream |
| Frontend context | `frontend/src/context/DeviceSyncContext.js` |
| UI | `frontend/src/components/DeviceSync/` |
| Player integration | `frontend/src/components/GlobalPlayerBar.js`, `deviceSyncControls.js` |
| Feature flag | `DEVICE_SYNC_ENABLED` in `frontend/src/api/runtimeConfig.js` |

## Test scripts

```bash
# Linux/macOS
./scripts/device-sync-docker-gate.sh --accounts 10 --devices 5

# Windows
./scripts/device-sync-docker-gate.ps1
./scripts/device-sync-smoke.ps1
```

Gate script starts `redis`, `auth-service`, `device-sync-service` and runs `device-sync-stress` profile.

## Implementation notes

- Sync state must be server-authoritative; UI reflects server events
- Respect `DEVICE_SYNC_ENABLED` — no hardcoded always-on in prod paths
- Auth required for all device sync API calls (gateway session)
- Test concurrent transfers with stress profile before merge of sync logic changes

## Checklist before merge

- [ ] Feature flag respected on frontend and backend
- [ ] No race: single active controller per party/device group
- [ ] Stress gate passes locally or in CI
- [ ] Player bar layout unchanged when panel closed (rail layout helpers)
