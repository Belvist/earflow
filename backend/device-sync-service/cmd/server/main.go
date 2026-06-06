// Command server is the entry point for device-sync-service.
//
// Production concerns this file owns (and nothing else does):
//   - reading config, failing fast on misconfiguration;
//   - wiring all singletons (logger, metrics, redis, registry, WS manager);
//   - starting http.Server with sensible timeouts;
//   - graceful shutdown: drain WS, stop HTTP, close redis, within deadline.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/earflow/music-platform/device-sync-service/internal/config"
	"github.com/earflow/music-platform/device-sync-service/internal/devices"
	"github.com/earflow/music-platform/device-sync-service/internal/httpapi"
	"github.com/earflow/music-platform/device-sync-service/internal/observability"
	"github.com/earflow/music-platform/device-sync-service/internal/ratelimit"
	"github.com/earflow/music-platform/device-sync-service/internal/redisx"
	wsx "github.com/earflow/music-platform/device-sync-service/internal/websocket"
)

// runHealthcheck performs a local liveness probe via HTTP and exits with 0 on
// success. Used by Docker HEALTHCHECK — distroless has no shell or curl.
func runHealthcheck() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3050"
	}
	cli := &http.Client{Timeout: 3 * time.Second}
	resp, err := cli.Get("http://127.0.0.1:" + port + "/health")
	if err != nil {
		fmt.Fprintln(os.Stderr, "healthcheck:", err)
		os.Exit(1)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintln(os.Stderr, "healthcheck: status", resp.StatusCode)
		os.Exit(1)
	}
}

func main() {
	for _, a := range os.Args[1:] {
		if a == "-healthcheck" || a == "--healthcheck" {
			runHealthcheck()
			return
		}
	}

	// Bootstrap: any error during config/redis/setup is FATAL. We prefer a
	// crash-loop over silently-broken traffic.
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "FATAL: %v\n", err)
		os.Exit(1)
	}
	log := observability.NewLogger(cfg.IsProd, cfg.Instance)
	log.Info("starting device-sync-service",
		slog.String("env", cfg.Env),
		slog.Int("port", cfg.Port),
		slog.Bool("enabled", cfg.Enabled),
	)

	metrics := observability.NewMetrics()

	rootCtx, cancelRoot := context.WithCancel(context.Background())
	defer cancelRoot()

	rdb, err := redisx.New(rootCtx, cfg)
	if err != nil {
		log.Error("redis init failed", slog.Any("err", err))
		os.Exit(1)
	}

	registry := devices.NewRegistry(rdb, cfg, log, metrics)
	go registry.RunTransferWorker(rootCtx)
	wsMgr := wsx.NewManager(rdb, registry, log, metrics)

	wsRL := ratelimit.NewPool(cfg.WS.RateLimitPerSecond, cfg.WS.RateLimitPerSecond*2)
	stopSweeper := wsRL.RunSweeper()

	wsDeps := wsx.ClientDeps{
		Config:   cfg,
		Registry: registry,
		Logger:   log,
		Metrics:  metrics,
		RL:       wsRL,
	}

	wsHandler := &wsx.UpgradeHandler{
		Config:  cfg,
		Manager: wsMgr,
		Deps:    wsDeps,
		Logger:  log,
	}

	router := httpapi.New(httpapi.Deps{
		Config:     cfg,
		Registry:   registry,
		Redis:      rdb,
		Logger:     log,
		Metrics:    metrics,
		WSUpgrader: wsHandler,
	})

	srv := &http.Server{
		Addr:              ":" + strconv.Itoa(cfg.Port),
		Handler:           router,
		ReadHeaderTimeout: cfg.HTTP.ReadHeader,
		// CRITICAL: WriteTimeout and ReadTimeout are explicitly ZERO.
		//
		// Go's net/http applies both timeouts to the underlying net.Conn even
		// after a successful WebSocket hijack. With a non-zero WriteTimeout the
		// kernel closes the socket the moment no bytes have been written for
		// that duration — which, for idle WebSocket connections between pings,
		// is exactly what we don't want. We observed 15s WriteTimeout killing
		// connections before the first client heartbeat (25s) even arrived.
		//
		// Slowloris protection for HTTP endpoints lives one level down:
		//   - ReadHeaderTimeout limits header parsing (set to HTTP_READ_HEADER_TIMEOUT),
		//   - the per-route middleware.Timeout in httpapi.New limits /api/* handlers,
		// and that is sufficient without killing long-lived WebSockets.
		WriteTimeout: 0,
		ReadTimeout:  0,
		// Non-zero IdleTimeout would still reap idle conns; WSS is «idle» between
		// client frames longer than pinging in edge cases. cfg.HTTP.Idle is for
		// other tuning — not applied to the front door Server.
		IdleTimeout: 0,
	}

	serveErr := make(chan error, 1)
	go func() {
		log.Info("listening",
			slog.String("addr", srv.Addr),
		)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
		}
	}()

	// Wait for signal or fatal serve error.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	select {
	case s := <-stop:
		log.Info("shutdown signal received", slog.String("signal", s.String()))
	case err := <-serveErr:
		log.Error("http server failed", slog.Any("err", err))
	}

	// Shutdown sequence:
	//   1) stop accepting new HTTP connections + drain in-flight requests;
	//   2) close every live WebSocket with 1012;
	//   3) release Redis clients.
	shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), cfg.HTTP.ShutdownTimeout)
	defer cancelShutdown()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Warn("http shutdown returned error", slog.Any("err", err))
	}

	wsMgr.Close()
	stopSweeper()
	if err := rdb.Close(); err != nil {
		log.Warn("redis close error", slog.Any("err", err))
	}

	// Give goroutines one final breath before the process exits.
	time.Sleep(100 * time.Millisecond)
	log.Info("graceful shutdown complete")
}
