# recommendations-service — Context Card

**Owner:** recommendations-service (Node 22, port 3006 internal)  
**Gateway:** `POST/GET /api/recommendations/*` → `require_user: true`  
**Engine:** `RECO_ENGINE=v2` — `services/engineV2/`

## Single source of truth (INV-REC-001)

| Concern | Owner |
|---------|--------|
| Session lifecycle | `services/sessionStateMachine.js` + Redis ephemeral sessions |
| Candidate retrieval | `services/engineV2/retrieval/*` |
| Ranking | `rankPipeline.js` → Go `ranking-service` primary, `ranking.js` `rankLocally` degraded fallback only |
| Similar / Radio | `engineV2/trackSeed.js` (not `personalRecommendations` API path) |
| Exclude / anti-repeat | Redis session impressions, bloom, daily seen, feedback realtime |
| Skip-burst refresh decision | **Backend only** — `clientActions.refreshRecommended` in feedback ack |
| Offline precompute | `reco-offline-worker` → Redis → `retrieval/offline.js` |

**Deprecated:** `GET /api/songs/recommendations` (database-service) → `410 RECO_LEGACY_DEPRECATED`

## Session state machine

States: `idle` | `active` | `skip_burst` | `expired`

API envelope on init/next/infinite/refresh:

```json
{
  "sessionId": "...",
  "tracks": [],
  "sessionState": { "state": "active", "skipBurstCount": 0, "skipBurstMode": false, "sessionValid": true },
  "clientActions": { "refreshRecommended": false, "skipBurstMode": false },
  "recommendationMeta": { "mode": "personalized", "profileStrength": 0.42 }
}
```

Feedback ack includes `sessionState` + `clientActions`; frontend must not count skip bursts locally.

## Client contract

- Auth user id from gateway/session only — **body `userId` ignored** (spoof rejected).
- **body `excludeIds` ignored** — server session owns exclusions.
- Frontend may cache tracks in `localStorage` for UX resume only (not business state).

## Workers

| Worker | Role |
|--------|------|
| `reco-feedback-worker-go` | Redis Stream → Postgres interactions |
| `reco-offline-worker` | Batch `computeUserRecommendations` → Redis offline lists |

## Key env

See `.env.example` — `RECO_V2_*`, `RECO_SESSION_SECRET` (prod ≥32 chars), `RECO_RANKING_SERVICE_URL`.

## Tests

```bash
cd backend/recommendations-service && node --test tests/
```
