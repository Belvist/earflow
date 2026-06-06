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

	"github.com/earflow/music-platform/security-service/internal/authz"
	"github.com/earflow/music-platform/security-service/internal/config"
	"github.com/earflow/music-platform/security-service/internal/httpapi"
	"github.com/earflow/music-platform/security-service/internal/store"
	"github.com/earflow/music-platform/security-service/internal/store/authpg"
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
	defer func() {
		_ = rd.Close()
	}()

	verifier := authz.Verifier{
		Secret:   cfg.JWT.Secret,
		Issuer:   cfg.JWT.Issuer,
		Audience: cfg.JWT.Audience,
	}

	pgMode := authpg.ParseMode()
	authPG := authpg.NewStore(pg.Pool())
	authSoT := &store.AuthSoT{PG: authPG, Mode: pgMode}
	logger.Info("auth postgres sot",
		slog.String("mode", string(pgMode)),
		slog.Bool("writes_enabled", pgMode.WritesEnabled()),
	)

	srv := httpapi.NewServer(httpapi.Deps{
		Config:   cfg,
		Redis:    rd,
		Postgres: pg,
		AuthSoT:  authSoT,
		Logger:   logger,
		Verifier: verifier,
	})

	go func() {
		<-rootCtx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			logger.Error("graceful shutdown failed", slog.String("err", err.Error()))
		}
	}()

	logger.Info("security-service listening",
		slog.String("addr", cfg.HTTP.Addr()),
		slog.Int("handler_timeout_ms", int(cfg.HTTP.HandlerTimeout.Milliseconds())),
	)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("http server failed", slog.String("err", err.Error()))
		os.Exit(1)
	}
}
