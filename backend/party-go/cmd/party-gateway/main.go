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

	"github.com/earflow/music-platform/party-go/internal/partygw"
	"github.com/nats-io/nats.go"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "--healthcheck" {
		port := os.Getenv("PORT")
		if port == "" {
			port = "3131"
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

	cfg := partygw.Load()
	nc, err := nats.Connect(cfg.NATSURL)
	if err != nil {
		log.Fatalf("nats: %v", err)
	}
	defer nc.Drain()
	s := partygw.New(nc, cfg)
	if len(s.Subs) == 0 {
		log.Print("warning: no NATS event subscriptions (check PARTY_V2_SHARD_COUNT / PARTY_V2_SHARDS)")
	}
	srv := &http.Server{
		Addr:              ":" + strconv.Itoa(cfg.Port),
		Handler:           s,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:        0,
		WriteTimeout:       0,
		IdleTimeout:        0,
	}
	go func() {
		ch := make(chan os.Signal, 1)
		signal.Notify(ch, syscall.SIGINT, syscall.SIGTERM)
		<-ch
		c, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_ = srv.Shutdown(c)
	}()
	log.Printf("party-gateway listening on :%d", cfg.Port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
