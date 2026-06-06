package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"ranking-service/internal/home"
	"ranking-service/internal/httpapi"
)

func envInt(name string, def int) int {
	v := os.Getenv(name)
	if v == "" {
		return def
	}
	i, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return i
}

func main() {
	port := envInt("PORT", 8080)
	maxBodyBytes := int64(envInt("MAX_BODY_BYTES", 2*1024*1024))

	if len(os.Args) > 1 && os.Args[1] == "--healthcheck" {
		client := http.Client{Timeout: 3 * time.Second}
		resp, err := client.Get("http://127.0.0.1:" + strconv.Itoa(port) + "/health")
		if err != nil {
			os.Exit(1)
		}
		_ = resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			os.Exit(1)
		}
		return
	}

	homeCfg, homeEnabled, err := home.LoadConfig()
	if err != nil {
		os.Exit(1)
	}
	var homeSvc *home.Service
	if homeEnabled {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		homeSvc, err = home.NewService(ctx, homeCfg)
		cancel()
		if err != nil {
			os.Exit(1)
		}
		defer homeSvc.Close()
	}

	srv := httpapi.NewServer(":"+strconv.Itoa(port), httpapi.ServerConfig{
		MaxBodyBytes: maxBodyBytes,
		Home:         homeSvc,
	})

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		errCh <- srv.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	case err := <-errCh:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			os.Exit(1)
		}
	}
}
