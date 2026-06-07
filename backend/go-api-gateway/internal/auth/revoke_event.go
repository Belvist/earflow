package auth

import (
	"encoding/json"
	"os"
	"strings"
	"time"
)

// PEND-SEC-012 — must match security-service/internal/store/revoke_event.go contract.
const defaultRevokePubSubChannel = "earflow:auth:session:revoke:v1"

// RevokeEvent is published by security-service after session revoke.
type RevokeEvent struct {
	SID          string `json:"sid"`
	UserID       int64  `json:"userId"`
	SessionEpoch int64  `json:"sessionEpoch"`
	Reason       string `json:"reason"`
	IssuedAt     string `json:"issuedAt"`
}

func revokePubSubChannel() string {
	ch := strings.TrimSpace(os.Getenv("AUTH_REVOKE_PUBSUB_CHANNEL"))
	if ch == "" {
		return defaultRevokePubSubChannel
	}
	return ch
}

func parseRevokeEvent(raw string) (RevokeEvent, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return RevokeEvent{}, false
	}
	var ev RevokeEvent
	if err := json.Unmarshal([]byte(raw), &ev); err != nil {
		return RevokeEvent{}, false
	}
	ev.SID = strings.TrimSpace(ev.SID)
	if ev.SID == "" {
		return RevokeEvent{}, false
	}
	if strings.TrimSpace(ev.IssuedAt) == "" {
		ev.IssuedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	return ev, true
}
