package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"reco-feedback-worker/internal/loadtest"
)

func main() {
	cfg := loadtest.DefaultConfig()

	flag.IntVar(&cfg.TotalInteractions, "total", cfg.TotalInteractions, "total interactions to publish")
	flag.IntVar(&cfg.InteractionsPerMessage, "per-message", cfg.InteractionsPerMessage, "interactions per redis stream message")
	flag.IntVar(&cfg.PublisherConcurrency, "pub", cfg.PublisherConcurrency, "publisher concurrency")
	flag.IntVar(&cfg.PipelineSize, "pipe", cfg.PipelineSize, "publisher pipeline size")

	flag.IntVar(&cfg.UserPoolSize, "user-pool", cfg.UserPoolSize, "user id pool size (fetched from DB)")
	flag.IntVar(&cfg.TrackPoolSize, "track-pool", cfg.TrackPoolSize, "track id pool size (fetched from DB)")

	flag.Float64Var(&cfg.ActionPlayRate, "rate-play", cfg.ActionPlayRate, "rate for play action")
	flag.Float64Var(&cfg.ActionCompleteRate, "rate-complete", cfg.ActionCompleteRate, "rate for complete action")
	flag.Float64Var(&cfg.ActionSkipRate, "rate-skip", cfg.ActionSkipRate, "rate for skip action")
	flag.Float64Var(&cfg.ActionLikeRate, "rate-like", cfg.ActionLikeRate, "rate for like action")
	flag.Float64Var(&cfg.ActionDislikeRate, "rate-dislike", cfg.ActionDislikeRate, "rate for dislike action")

	flag.DurationVar(&cfg.DrainTimeout, "drain-timeout", cfg.DrainTimeout, "timeout waiting for stream to drain")
	flag.DurationVar(&cfg.DrainPoll, "drain-poll", cfg.DrainPoll, "poll interval while waiting for drain")

	flag.StringVar(&cfg.EventPrefix, "event-prefix", cfg.EventPrefix, "event id prefix")
	flag.StringVar(&cfg.SessionPrefix, "session-prefix", cfg.SessionPrefix, "session id prefix")

	flag.Parse()

	ctx := context.Background()
	res, err := loadtest.Run(ctx, cfg)
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}

	eventsPerSec := float64(res.TotalInteractions) / res.TotalDuration.Seconds()
	fmt.Printf("published_interactions=%d\n", res.TotalInteractions)
	fmt.Printf("published_messages=%d\n", res.TotalMessages)
	fmt.Printf("publish_duration=%s\n", res.PublishedIn.Round(time.Millisecond))
	fmt.Printf("drain_duration=%s\n", res.DrainedIn.Round(time.Millisecond))
	fmt.Printf("total_duration=%s\n", res.TotalDuration.Round(time.Millisecond))
	fmt.Printf("throughput_interactions_per_sec=%.2f\n", eventsPerSec)
}
