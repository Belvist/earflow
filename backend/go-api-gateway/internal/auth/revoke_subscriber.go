package auth

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strconv"
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

// Local revocation mark with explicit lifecycle (so the sweep goroutine can
// tell fresh signal from old history).
type revokedSidMark = localRevokeMark

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

	// DECISIONS 2026-08-11 (SEC-010): safety-net sweep for missed pub/sub events.
	// Redis Pub/Sub has NO delivery guarantee — a disconnected gateway (deploy,
	// network blip, DB reconnect) will drop every event during its outage.
	// Without a periodic sweep, that pod will accept revoked sessions until it
	// crashes on its own. Our sweep re-reads the auth revocation source of truth
	// every `AUTH_REVOCATION_SWEEP_INTERVAL` (default 30s) and syncs the local
	// `revokeMarks` cache against it.
	startRevocationSweep(ctx, m)

	slog.Info("auth revocation sweep started", "interval", revocationSweepInterval().String())
}

// startRevocationSweep periodically reconciles the local revokeMarks +
// proofEpochs cache with the shared auth-redis committer. Catching up on
// events published while we were disconnected from the pubsub channel
// (network partition, pod restart, rolling update).
//
// Cost: one SCAN+GET per sweep across the shared auth-redis room for all known
// session TTLs. This is O(active_sids) per gate per sweep — at 100k sessions
// and 30s interval this is manageable (lookup rate ~3.3k rps spread). If we
// ever scale past 10k concurrent authenticated sessions, we must switch to
// the delta-based protocol (PG → active log, no full scan).
func startRevocationSweep(ctx context.Context, m *SessionManager) {
	interval := revocationSweepInterval()
	ticker := time.NewTicker(interval)
	go func() {
		defer ticker.Stop()
		slog.Info("auth revocation sweep worker started", slog.String("interval", interval.String()))
		// M-4: sync IMMEDIATELY on startup. After a restart the epoch floor and
		// revoke marks are empty, so a token revoked during the outage would
		// validate until the first tick (~30s). The immediate pass closes it.
		m.reconcileRevocationsWithRedis(ctx)
		ticks := 0
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				m.reconcileRevocationsWithRedis(ctx)
				ticks++
				if ticks%proofEpochGCEveryNTicks == 0 {
					m.gcLocalAuthCaches()
				}
			}
		}
	}()
}

const (
	// M-5: in-memory auth caches are bounded by activity window. Proof-epoch
	// floors protect only tokens issued before a bump — those die with token
	// TTL (≤60s) — so floors untouched for a day are dead weight. Revoked-sid
	// marks protect only tokens issued before the revocation (expired quickly)
	// AND the session key itself is already deleted by RevokeSessionFull; the
	// sweep re-populates still-revoked sids every tick, so GC is safe.
	proofEpochMaxAge        = 24 * time.Hour
	revokeMarkMaxAge        = time.Hour
	proofEpochGCEveryNTicks = 10 // ≈5min at the default 30s sweep interval
)

// gcLocalAuthCaches drops stale entries from the local auth caches (M-5).
func (m *SessionManager) gcLocalAuthCaches() {
	now := time.Now().UTC()
	if m.proofEpochs != nil {
		m.proofEpochs.gc(now, proofEpochMaxAge)
	}
	if m.revokeMarks == nil {
		return
	}
	m.revokeMarks.Range(func(k, v any) bool {
		if mark, ok := v.(localRevokeMark); ok && !mark.at.IsZero() && now.Sub(mark.at) > revokeMarkMaxAge {
			m.revokeMarks.Delete(k)
		}
		return true
	})
}

// revocationSweepInterval resolves to `AUTH_REVOCATION_SWEEP_INTERVAL` env;
// `auth:revocations:` key prefix (repopulated by security-service) is used
// to enumerate sids currently revoked server-side.
func revocationSweepInterval() time.Duration {
	raw := strings.TrimSpace(os.Getenv("AUTH_REVOCATION_SWEEP_INTERVAL"))
	if d, err := time.ParseDuration(raw); err == nil && d >= 5*time.Second {
		return d
	}
	return 30 * time.Second
}

// reconcileRevocationsWithRedis repopulates revokeMarks from the Redis
// revocation index. Called on each sweep tick.
//
// Redis contract (auth service / user-auth):
//   auth:sids:revoked       — set<sid>, members = currently revoked
//   auth:session:{sid}:epoch — string, session epoch when revoked
// (kept under auth-redis, not main redis)
func (m *SessionManager) reconcileRevocationsWithRedis(ctx context.Context) {
	if m.rdb == nil {
		return
	}
	ctxTimeout, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	revoked, err := m.rdb.SMembers(ctxTimeout, "auth:sids:revoked").Result()
	if err != nil {
		slog.Warn("auth revocation sweep: Redis list failed",
			slog.String("key", "auth:sids:revoked"),
			slog.Any("err", err))
		return
	}
	if len(revoked) == 0 {
		return
	}

	count := 0
	for _, sid := range revoked {
		sid = strings.TrimSpace(sid)
		if sid == "" {
			continue
		}
		if m.revokeMarks == nil {
			break
		}
		if _, ok := m.revokeMarks.Load(sid); !ok {
			// Unknown locally — we've just missed the event. Get the epoch.
			epochRaw, err := m.rdb.Get(ctxTimeout, fmt.Sprintf("auth:session:%s:epoch", sid)).Result()
			if err != nil {
				continue
			}
			epoch, err := strconv.ParseInt(strings.TrimSpace(epochRaw), 10, 64)
			if err != nil || epoch <= 0 {
				continue
			}
			// Mark locally without writing to Redis (caller already knows).
			m.markSessionLocallyRevoked(sid, epoch, "sweep")
			// M-4: also bump the proof epoch floor, matching the live pub/sub
			// handler. Without this a token issued at the old epoch would pass
			// sessionEpochStale after a restart until the floor is raised.
			if m.proofEpochs != nil {
				m.proofEpochs.bumpSessionEpoch(sid, epoch)
			}
		}
		count++
	}
	if count > 0 {
		slog.Debug("auth revocation sweep yielded updates", slog.Int("count", count))
	}
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
	nodeSID, nodeJTI := m.nodeSessionClaims(ctx, ev.SID)
	_ = RevokeSessionFull(ctx, m.rdb, prefix, ev.SID, ev.UserID, "")
	if nodeSID != "" || nodeJTI != "" {
		_ = revokeNodeSession(ctx, m.rdb, ev.UserID, nodeSID, nodeJTI)
	}
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
