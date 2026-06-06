//go:build pop_e2e_harness

package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/earflow/music-platform/go-api-gateway/internal/auth"
)

// pop-e2e-harness: real go-api-gateway auth middleware + miniredis for Playwright PoP e2e.
// Production PoP enforced (isProduction=true). No ALLOW_COOKIE_AUTH_WITHOUT_PROOF.
func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	h, err := auth.StartPopE2EHarness(ctx)
	if err != nil {
		log.Fatalf("pop-e2e-harness: %v", err)
	}
	log.Printf("pop-e2e-harness listening on %s (PoP enforced, no mock routes)", h.BaseURL)

	<-ctx.Done()
	_ = h.Close()
	os.Exit(0)
}
