---
name: earflow-streaming
description: Implements and debugs Earflow audio streaming — direct stream, EBAP HLS, transcode pipeline, MinIO media, iOS playback. Use when working on direct-stream-service, ebap-hls-adapter, ebap-hls-packager-worker, transcode-worker, upload-service, stream cookies, hls.js player, or /api/stream/* and /api/ebap-hls/* routes.
---

# Earflow Streaming

## Architecture

```
Upload → upload-service → MinIO → transcode-worker / ebap-encoder-worker
Playback (web):  gateway → direct-stream-service → MinIO (mp_stream cookie)
Playback (iOS):  gateway → ebap-hls-adapter → HLS segments in MinIO
```

## Key files

| Component | Path |
|-----------|------|
| Gateway routes | `backend/go-api-gateway/gateway.yaml` (`/api/stream/v2`, `/api/stream/v3`, `/api/ebap-hls`) |
| Direct stream | `backend/direct-stream-service/` |
| HLS adapter | `backend/ebap-hls-adapter/` |
| Transcode | `backend/transcode-worker/`, `backend/ebap-hls-packager-worker/` |
| Player UI | `frontend/src/components/GlobalPlayerBar.js`, hls.js usage |

## Session flow

1. Client POST `/api/stream/v2/session` or `/api/ebap-hls/v1/session` (auth required)
2. Gateway validates user, upstream issues signed stream token / cookie
3. Audio fetched via gateway-proxied URLs; never expose raw MinIO URLs to browser

## Policy classes (gateway)

- `class: stream` — playback GET/HEAD
- `class: unsafe` — session create/refresh (CSRF + auth)
- `rate_limit: stream` — always on stream paths

## Debugging checklist

- [ ] User authenticated (`require_user: true` routes)
- [ ] Stream cookie / session not expired
- [ ] MinIO object exists for track ID
- [ ] Transcode job completed (check worker logs)
- [ ] Nginx cache headers for media (`nginx/` configs)
- [ ] iOS: EBAP HLS segments present; adapter health OK

## Do not

- Bypass gateway for authenticated stream URLs in production
- Weaken stream rate limits or remove `require_user`
- Commit presigned URLs with long TTL in frontend code
