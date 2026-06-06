FROM golang:1.22-alpine AS builder

WORKDIR /src

COPY go.mod ./
RUN go env -w GOPROXY=https://proxy.golang.org,direct \
    && go mod download

COPY . ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags "-s -w" \
    -o /out/search-service ./cmd/search-service

FROM alpine:3.21
RUN addgroup -S app \
    && adduser -S -G app app \
    && apk add --no-cache ca-certificates wget

WORKDIR /app
COPY --from=builder /out/search-service /app/search-service

USER app
EXPOSE 3062

ENTRYPOINT ["/app/search-service"]
