FROM golang:1.22-alpine AS builder

WORKDIR /src

ARG APP_VERSION=dev
ARG GIT_SHA=unknown

COPY go.mod ./
COPY go.sum ./
RUN go env -w GOPROXY=https://proxy.golang.org,direct \
    && go mod download

COPY . ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/api-gateway ./cmd/gateway

FROM alpine:3.21
RUN addgroup -S app \
    && adduser -S -G app app \
    && apk add --no-cache ca-certificates

WORKDIR /app
COPY --from=builder /out/api-gateway /app/api-gateway
COPY gateway.yaml /app/gateway.yaml
COPY gateway.artist.yaml /app/gateway.artist.yaml

USER app
EXPOSE 3000

ENV GATEWAY_CONFIG_PATH=/app/gateway.yaml

ENV APP_VERSION=$APP_VERSION
ENV GIT_SHA=$GIT_SHA

ENTRYPOINT ["/app/api-gateway"]
