FROM golang:1.22-alpine AS builder

WORKDIR /src

COPY go.mod ./
RUN go mod download

COPY . ./

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags "-s -w" \
    -o /out/reco-feedback-worker ./cmd/reco-feedback-worker

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags "-s -w" \
    -o /out/reco-feedback-loadgen ./cmd/reco-feedback-loadgen

FROM alpine:3.19

RUN apk add --no-cache ca-certificates

WORKDIR /app
COPY --from=builder /out/reco-feedback-worker /app/reco-feedback-worker
COPY --from=builder /out/reco-feedback-loadgen /app/reco-feedback-loadgen

EXPOSE 3016
ENTRYPOINT ["/app/reco-feedback-worker"]
