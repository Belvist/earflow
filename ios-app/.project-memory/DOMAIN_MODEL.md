# Domain Model — Earflow iOS (client projection)

Client holds **DTOs** matching gateway JSON — not authoritative domain entities.

## Identity

| Entity | Source | Client storage |
|--------|--------|----------------|
| `UserProfile` | `/api/auth/*`, profile endpoints | `AuthActor.profile` (memory) |
| Session | Gateway cookies | URLSession cookie jar |
| Device identity | `/api/auth/device/register` | Keychain (P-256 key, authDeviceId, sidHash) |
| Proof access token | `/api/auth/proof/token` | Memory cache ~90s |

## Catalog

| Entity | Fields (subset) | Notes |
|--------|-----------------|-------|
| `TrackItem` | id, title, artist, album, coverUrl/cover_path, duration | Playback key = `id` |
| `DiscoverRail` | id/key, title, playlists[], tracks[] | Backend may nest playlists |
| `DiscoverPlaylist` | id, title, tracks[] | |

## Search

| Entity | Notes |
|--------|-------|
| `SearchResponse` | tracks, artists, albums arrays |
| `SearchArtist` | id, name |
| `SearchAlbum` | id, title |

## Social

| Entity | Notes |
|--------|-------|
| `SocialPostDTO` | id, title, body, author, metrics, viewer |
| `SocialAuthorDTO` | displayName, avatarUrl, initials |
| `SocialViewerDTO` | liked, canManage — **from backend only** |

## Playback

| Entity | Owner |
|--------|-------|
| `PlaybackSessionRef` | PlaybackActor — playbackSessionId, trackId, masterURL |
| `NowPlaying` (UI) | PlaybackCoordinator — display copy of `TrackItem` |

## Invariants

- Client never invents `userId` for API auth.
- `viewer.canManage` / `liked` not computed on client.
- Track IDs are integers from backend; client does not reassign.
