// Package observability centralizes logging / metrics wiring so hot paths
// never import driver packages directly. Everything here must be
// allocation-conscious because it sits on every request.
package observability

import (
	"log/slog"
	"os"
)

// NewLogger returns a structured logger. In production we emit JSON (easy to
// parse in Loki/Datadog); locally we emit text for human readability.
// slog is the standard library's structured logger available since Go 1.21
// and has near-zero-alloc semantics when used with typed attributes.
func NewLogger(isProd bool, instance string) *slog.Logger {
	var handler slog.Handler
	opts := &slog.HandlerOptions{
		AddSource: false,
		Level:     slog.LevelInfo,
	}
	if !isProd {
		opts.Level = slog.LevelDebug
		handler = slog.NewTextHandler(os.Stdout, opts)
	} else {
		handler = slog.NewJSONHandler(os.Stdout, opts)
	}
	return slog.New(handler).With(
		slog.String("service", "device-sync-service"),
		slog.String("instance", instance),
	)
}
