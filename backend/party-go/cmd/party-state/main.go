package main

import (
	"context"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/earflow/music-platform/party-go/internal/party"
	"github.com/earflow/music-platform/party-go/internal/stateserver"
	"github.com/go-chi/chi/v5"
	"github.com/go-redis/redis/v8"
	"github.com/nats-io/nats.go"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "--healthcheck" {
		port := os.Getenv("PORT")
		if port == "" {
			port = "3130"
		}
		c, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		req, err := http.NewRequestWithContext(c, http.MethodGet, "http://127.0.0.1:"+port+"/health", nil)
		if err != nil {
			os.Exit(1)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			os.Exit(1)
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			os.Exit(1)
		}
		os.Exit(0)
	}

	cfg := stateserver.LoadConfig()
	if cfg.JWTSecret == "" || len(cfg.JWTSecret) < 32 {
		log.Fatal("JWT_SECRET (min 32) required")
	}
	if cfg.WSTokenSecret == "" {
		log.Fatal("PARTY_V2_WS_TOKEN_SECRET or JWT_SECRET required")
	}

	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
		DB:       cfg.RedisDB,
	})
	ctx := context.Background()
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Fatalf("redis: %v", err)
	}

	nc, err := nats.Connect(cfg.NATSURL)
	if err != nil {
		log.Fatalf("nats: %v", err)
	}
	defer nc.Drain()

	st := party.NewStore(rdb, cfg.SessionTTL, cfg.MaxParticipants)
	h := &stateserver.Handler{
		Store:     st,
		Cfg:       cfg,
		JWTSecret: cfg.JWTSecret,
	}
	r := chi.NewRouter()
	h.Register(r)

	hCtx, stop := context.WithCancel(context.Background())
	h.StartNATSWorker(hCtx, nc, nil)
	defer stop()

	srv := &http.Server{
		Addr:              ":" + strconv.Itoa(cfg.Port),
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		ch := make(chan os.Signal, 1)
		signal.Notify(ch, syscall.SIGINT, syscall.SIGTERM)
		<-ch
		c, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		_ = srv.Shutdown(c)
	}()
	log.Printf("party-state listening on :%d", cfg.Port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
