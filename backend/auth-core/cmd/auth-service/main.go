package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/earflow/music-platform/auth-core/internal/authn"
	"github.com/earflow/music-platform/auth-core/internal/config"
	"github.com/earflow/music-platform/auth-core/internal/httpapi"
	"github.com/earflow/music-platform/auth-core/internal/store"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		_, _ = os.Stderr.WriteString("config: " + err.Error() + "\n")
		os.Exit(1)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.Logging.Level}))
	slog.SetDefault(logger)

	rootCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	initCtx, cancelInit := context.WithTimeout(rootCtx, 20*time.Second)
	defer cancelInit()

	pg, err := store.NewPostgres(initCtx, cfg.Postgres)
	if err != nil {
		logger.Error("postgres init failed", slog.String("err", err.Error()))
		os.Exit(1)
	}
	defer pg.Close()

	rd, err := store.NewRedis(initCtx, cfg.Redis)
	if err != nil {
		logger.Error("redis init failed", slog.String("err", err.Error()))
		os.Exit(1)
	}
	defer func() { _ = rd.Close() }()

	svc := authn.NewService(pg, rd, cfg)

	srv := httpapi.NewServer(httpapi.Deps{
		Config:   cfg,
		Redis:    rd,
		Postgres: pg,
		Logger:   logger,
		Svc:      svc,
	})

	go func() {
		<-rootCtx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			logger.Error("graceful shutdown failed", slog.String("err", err.Error()))
		}
	}()

	logger.Info("auth-core listening",
		slog.String("addr", cfg.HTTP.Addr()),
		slog.Int("handler_timeout_ms", int(cfg.HTTP.HandlerTimeout.Milliseconds())),
	)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("http server failed", slog.String("err", err.Error()))
		os.Exit(1)
	}
}
