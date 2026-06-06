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

	"github.com/earflow/music-platform/search-service/internal/config"
	"github.com/earflow/music-platform/search-service/internal/httpapi"
	"github.com/earflow/music-platform/search-service/internal/indexer"
	"github.com/earflow/music-platform/search-service/internal/meili"
	"github.com/earflow/music-platform/search-service/internal/migrate"
	"github.com/earflow/music-platform/search-service/internal/observability"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		os.Exit(1)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.Logging.Level}))
	slog.SetDefault(logger)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := pgxpool.New(ctx, cfg.Postgres.DSN())
	if err != nil {
		logger.Error("db init failed", slog.String("err", err.Error()))
		os.Exit(1)
	}
	defer pool.Close()

	migrator := migrate.New(pool)
	if err := migrator.Apply(ctx); err != nil {
		logger.Error("migrations failed", slog.String("err", err.Error()))
		os.Exit(1)
	}

	meiliClient := meili.New(cfg.Meili)
	metrics := observability.NewMetrics()

	idx := indexer.New(indexer.Config{
		DB:           pool,
		Meili:        meiliClient,
		Logger:       logger,
		NodeID:       cfg.InstanceID,
		Batch:        cfg.Indexer.BatchSize,
		LockTTL:      cfg.Indexer.LockTTL,
		BaseBackoff:  cfg.Indexer.BaseBackoff,
		MaxBackoff:   cfg.Indexer.MaxBackoff,
		Backfill:     cfg.Indexer.BackfillOnStart,
		SetupIndexes: cfg.Indexer.SetupIndexes,
	})

	if cfg.Indexer.Enabled {
		go func() {
			if err := idx.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
				logger.Error("indexer stopped", slog.String("err", err.Error()))
			}
		}()
	}

	srv := httpapi.NewServer(httpapi.ServerConfig{
		Addr:           cfg.HTTP.Addr(),
		Logger:         logger,
		Meili:          meiliClient,
		DB:             pool,
		PublicMaxLimit: cfg.HTTP.PublicMaxLimit,
		AuthedMaxLimit: cfg.HTTP.AuthedMaxLimit,
		RequestTimeout: cfg.HTTP.RequestTimeout,
		Metrics:        metrics,
	})

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()

	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("http server failed", slog.String("err", err.Error()))
		os.Exit(1)
	}
}
