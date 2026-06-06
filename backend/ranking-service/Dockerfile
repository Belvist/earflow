FROM golang:1.22-alpine3.20 AS builder

WORKDIR /src

COPY go.mod ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/ranking-service ./cmd/ranking-service

FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=builder /out/ranking-service /ranking-service

EXPOSE 8080

USER nonroot:nonroot

ENTRYPOINT ["/ranking-service"]
