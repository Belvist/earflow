package auth

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

type localRevokeMark struct {
	epoch  int64
	reason string
	at     time.Time
}

// StartRevokeSubscriber listens for session revoke events and invalidates local state.
// Idempotent: duplicate events for the same sid+epoch are ignored.
func (m *SessionManager) StartRevokeSubscriber(ctx context.Context) {
	if m == nil || m.rdb == nil {
		return
	}
	if m.revokeSubStarted.Swap(true) {
		return
	}
	if m.revokeMarks == nil {
		m.revokeMarks = &sync.Map{}
	}

	go func() {
		slog.Info("auth revoke subscriber started", "channel", revokePubSubChannel())
		for {
			if ctx.Err() != nil {
				return
			}
			sub := m.rdb.Subscribe(ctx, revokePubSubChannel())
			err := m.consumeRevokeSubscription(ctx, sub)
			_ = sub.Close()
			if ctx.Err() != nil {
				return
			}
			slog.Warn("auth revoke subscriber disconnected; reconnecting", "err", err)
			timer := time.NewTimer(500 * time.Millisecond)
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-timer.C:
			}
		}
	}()
}

func (m *SessionManager) consumeRevokeSubscription(ctx context.Context, sub *redis.PubSub) error {
	ch := sub.Channel()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case msg, ok := <-ch:
			if !ok {
				return redis.ErrClosed
			}
			if msg == nil {
				continue
			}
			m.handleRevokePubSubMessage(ctx, msg.Payload)
		}
	}
}

func (m *SessionManager) handleRevokePubSubMessage(ctx context.Context, payload string) {
	ev, ok := parseRevokeEvent(payload)
	if !ok {
		return
	}
	if m.shouldSkipRevokeEvent(ev) {
		return
	}
	m.markSessionLocallyRevoked(ev.SID, ev.SessionEpoch, ev.Reason)
	if m.proofEpochs != nil && ev.SessionEpoch > 0 {
		m.proofEpochs.bumpSessionEpoch(ev.SID, ev.SessionEpoch)
	}

	prefix := m.gatewaySessionPrefix
	if prefix == "" {
		prefix = GatewaySessionKeyPrefix()
	}
	_ = RevokeSessionFull(ctx, m.rdb, prefix, ev.SID, ev.UserID, "")
}

func (m *SessionManager) shouldSkipRevokeEvent(ev RevokeEvent) bool {
	if ev.SessionEpoch <= 0 || m.revokeMarks == nil {
		return false
	}
	if prev, loaded := m.revokeMarks.Load(ev.SID); loaded {
		if mark, ok := prev.(localRevokeMark); ok && mark.epoch >= ev.SessionEpoch && ev.SessionEpoch > 0 {
			return true
		}
	}
	return false
}

func (m *SessionManager) markSessionLocallyRevoked(sid string, epoch int64, reason string) {
	if m.revokeMarks == nil {
		m.revokeMarks = &sync.Map{}
	}
	m.revokeMarks.Store(strings.TrimSpace(sid), localRevokeMark{
		epoch:  epoch,
		reason: strings.TrimSpace(reason),
		at:     time.Now().UTC(),
	})
}

func (m *SessionManager) isSessionLocallyRevoked(sid string) bool {
	if m.revokeMarks == nil {
		return false
	}
	_, ok := m.revokeMarks.Load(strings.TrimSpace(sid))
	return ok
}
