package streamticket

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const defaultRevokeChannel = "earflow:auth:session:revoke:v1"

type revokeEvent struct {
	SID          string `json:"sid"`
	SessionEpoch int64  `json:"sessionEpoch"`
}

// StartRevokeSubscriber listens for gateway/security revoke pub/sub events.
func StartRevokeSubscriber(ctx context.Context, rdb *redis.Client, cache *EpochCache, logger *slog.Logger) {
	if rdb == nil || cache == nil {
		return
	}
	channel := strings.TrimSpace(os.Getenv("STREAM_TICKET_REVOKE_CHANNEL"))
	if channel == "" {
		channel = strings.TrimSpace(os.Getenv("AUTH_REVOKE_PUBSUB_CHANNEL"))
	}
	if channel == "" {
		channel = defaultRevokeChannel
	}

	sub := redis.NewClient(rdb.Options())
	go func() {
		defer func() { _ = sub.Close() }()
		for {
			select {
			case <-ctx.Done():
				return
			default:
			}

			pubsub := sub.Subscribe(ctx, channel)
			ch := pubsub.Channel()
			for {
				select {
				case <-ctx.Done():
					_ = pubsub.Close()
					return
				case msg, ok := <-ch:
					if !ok {
						_ = pubsub.Close()
						goto resubscribe
					}
					var ev revokeEvent
					if err := json.Unmarshal([]byte(msg.Payload), &ev); err != nil {
						continue
					}
					sid := strings.TrimSpace(ev.SID)
					if sid == "" {
						continue
					}
					cache.MarkSessionRevoked(sid)
					if ev.SessionEpoch > 0 {
						cache.BumpSessionEpoch(sid, ev.SessionEpoch)
					}
				}
			}
		resubscribe:
			if logger != nil {
				logger.Warn("streamticket: revoke subscriber reconnecting")
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(500 * time.Millisecond):
			}
		}
	}()
}
