# syntax=docker/dockerfile:1.7-labs

# =============================================================================
# device-sync-service — production Go image.
# Multi-stage: builder with full toolchain, final runtime = distroless-static.
# Size budget: final image ≤ 25 MB.
# =============================================================================

FROM golang:1.22-alpine AS builder

ENV GOTOOLCHAIN=local \
    CGO_ENABLED=0

# Build dependencies. git is required by `go mod download` to fetch some
# transitive modules hosted on git forges.
RUN apk add --no-cache git ca-certificates && \
    update-ca-certificates

WORKDIR /src

# Cache modules in a separate layer so source changes don't re-download deps.
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY cmd ./cmd
COPY internal ./internal

# `-s -w` strips the symbol table and DWARF. `-trimpath` removes absolute paths
# from stack traces so binaries are reproducible across build hosts.
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    go build \
      -trimpath \
      -ldflags="-s -w -buildid=" \
      -o /out/device-sync-service \
      ./cmd/server && \
    go build \
      -trimpath \
      -ldflags="-s -w -buildid=" \
      -o /out/device-sync-smoke \
      ./cmd/device-sync-smoke && \
    chmod +x /out/device-sync-service /out/device-sync-smoke

# =============================================================================
# Runtime image: distroless/static-debian12 :nonroot runs as uid 65532.
# =============================================================================

FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app

COPY --from=builder /out/device-sync-service /app/device-sync-service
COPY --from=builder /out/device-sync-smoke /app/device-sync-smoke

USER nonroot:nonroot

EXPOSE 3050

# Liveness probe runs *inside* the image (distroless has no /bin/sh), so we
# reuse the server binary with a `healthcheck` mode would be over-engineering;
# orchestrator-level healthchecks via HTTP are handled from docker-compose.yml.
ENTRYPOINT ["/app/device-sync-service"]
