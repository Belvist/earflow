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

	"reco-feedback-worker/internal/config"
	"reco-feedback-worker/internal/db"
	"reco-feedback-worker/internal/health"
	"reco-feedback-worker/internal/metrics"
	"reco-feedback-worker/internal/processor"
	"reco-feedback-worker/internal/redisstream"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		os.Exit(1)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.Logging.Level}))
	slog.SetDefault(logger)

	m := metrics.New()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	redisClient, err := redisstream.NewClient(cfg)
	if err != nil {
		logger.Error("redis init failed", slog.String("err", err.Error()))
		os.Exit(1)
	}
	defer redisClient.Close()

	dbPool, err := db.New(cfg)
	if err != nil {
		logger.Error("db init failed", slog.String("err", err.Error()))
		os.Exit(1)
	}
	defer dbPool.Close()

	h := health.NewServer(cfg, m)
	go func() {
		if err := h.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("health server failed", slog.String("err", err.Error()))
		}
	}()

	w := processor.New(cfg, redisClient, dbPool, h, m)

	if err := redisClient.InitFeedbackStream(ctx); err != nil {
		logger.Error("init feedback stream failed", slog.String("err", err.Error()))
		os.Exit(1)
	}

	workerErrCh := make(chan error, 1)
	go func() {
		workerErrCh <- w.Run(ctx)
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.Worker.ShutdownTimeout)
		defer cancel()
		_ = w.Shutdown(shutdownCtx)
		_ = h.Shutdown(shutdownCtx)
		return
	case err := <-workerErrCh:
		if err != nil {
			logger.Error("worker stopped with error", slog.String("err", err.Error()))
		}
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = h.Shutdown(shutdownCtx)
		if err != nil {
			os.Exit(1)
		}
		return
	}
}
