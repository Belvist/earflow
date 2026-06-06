# Nginx Layout

`nginx.conf` remains the single entry point loaded by the container.

Shared HTTP-level policy is split into `conf.d/*.conf`:

- `00-log-formats.conf` - access/media/security log formats.
- `10-global-maps.conf` - global maps such as WebSocket upgrade handling.
- `20-media-maps.conf` - HLS/media auth and CORS maps.
- `30-http-core.conf` - cache zones, request limits, timeouts, and core HTTP defaults.
- `40-compression.conf` - gzip settings.
- `50-ssl.conf` - TLS defaults, OCSP, and Docker DNS resolver.
- `60-upstreams.conf` - Docker service upstreams.
- `70-rate-limits.conf` - shared request and connection limit zones.

Keep site-specific `server` and `location` blocks in `nginx.conf` until they are
split in a separate verified step. This keeps route behavior stable while making
shared policy safer to review and edit.
