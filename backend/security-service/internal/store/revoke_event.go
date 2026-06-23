package store

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"time"
)

// PEND-SEC-012 — Redis pub/sub fan-out for session revoke across gateway replicas.
const defaultRevokePubSubChannel = "earflow:auth:session:revoke:v1"

const (
	RevokeReasonOne         = "revoke_one"
	RevokeReasonOthers      = "revoke_others"
	RevokeReasonPassword    = "password_change"
	RevokeReasonInternal    = "internal"
	RevokeReasonLogout      = "logout"
)

// RevokeEvent is the JSON payload published after a successful session revoke.
type RevokeEvent struct {
	SID          string `json:"sid"`
	UserID       int64  `json:"userId"`
	SessionEpoch int64  `json:"sessionEpoch"`
	Reason       string `json:"reason"`
	IssuedAt     string `json:"issuedAt"`
}

func RevokePubSubChannel() string {
	ch := strings.TrimSpace(os.Getenv("AUTH_REVOKE_PUBSUB_CHANNEL"))
	if ch == "" {
		return defaultRevokePubSubChannel
	}
	return ch
}

func (e RevokeEvent) Valid() bool {
	return strings.TrimSpace(e.SID) != ""
}

// PublishRevokeEvent notifies gateway replicas (best-effort; Redis revoke remains SoT for hot path).
func (r *RedisClient) PublishRevokeEvent(ctx context.Context, ev RevokeEvent) error {
	if r == nil || r.c == nil || !ev.Valid() {
		return nil
	}
	if strings.TrimSpace(ev.IssuedAt) == "" {
		ev.IssuedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	if strings.TrimSpace(ev.Reason) == "" {
		ev.Reason = RevokeReasonInternal
	}
	raw, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	return r.c.Publish(ctx, RevokePubSubChannel(), raw).Err()
}
