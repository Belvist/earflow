FROM golang:1.22-alpine AS builder

WORKDIR /src

COPY go.mod go.sum ./
RUN go env -w GOPROXY=https://proxy.golang.org,direct \
    && go mod download

COPY . ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags "-s -w" \
    -o /out/auth-service ./cmd/auth-service

FROM alpine:3.21
RUN addgroup -S app \
    && adduser -S -G app app \
    && apk add --no-cache ca-certificates wget \
    && mkdir -p /app \
    && chown -R app:app /app

WORKDIR /app
COPY --from=builder --chown=app:app /out/auth-service /app/auth-service

USER app
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3001/health >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/app/auth-service"]
