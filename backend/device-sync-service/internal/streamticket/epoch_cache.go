package streamticket

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// Shared-floor design (SEC-005, DECISIONS 2026-08-09):
//
// Epoch floors and revoke tombstones MUST be identical on every device-sync
// replica. A pure in-memory map per process is a race: a replica that
// restarted (or missed a pub/sub event during reconnect) enforces an old
// floor and accepts/rejects tickets differently from its peers.
//
// SoT for floors/tombstones is auth-redis (the same instance that stores
// opaque tickets). The in-memory maps remain only as an L1 hint for the
// revoke-subscriber hot path; reads consult Redis on a local miss.
// A WS upgrade performs at most 2 extra GETs — acceptable, it is not a
// per-segment hot path (forbidden by SEC-005).
const (
	defaultEpochKeyPrefix   = "auth:session:"
	epochFloorKeySuffix     = "epoch:"
	revokedTombstoneSuffix  = "revoked:"
	sharedFloorTTL          = 45 * 24 * time.Hour // outlives refresh-token TTL
	sharedOpTimeout         = time.Second
)

// EpochCache tracks session/device epoch floors and revoked sids.
type EpochCache struct {
	mu          sync.RWMutex
	sessions    map[string]int64
	devices     map[string]int64
	revokedSids map[string]struct{}

	rdb       *redis.Client // auth-redis; nil => pure in-memory (unit tests)
	keyPrefix string
}

func NewEpochCache(rdb *redis.Client) *EpochCache {
	prefix := strings.TrimSpace(os.Getenv("STREAM_TICKET_EPOCH_KEY_PREFIX"))
	if prefix == "" {
		prefix = defaultEpochKeyPrefix
	}
	return &EpochCache{
		sessions:    make(map[string]int64),
		devices:     make(map[string]int64),
		revokedSids: make(map[string]struct{}),
		rdb:         rdb,
		keyPrefix:   prefix,
	}
}

func (c *EpochCache) epochFloorKey(sid string) string {
	return c.keyPrefix + epochFloorKeySuffix + sid
}

func (c *EpochCache) revokedKey(sid string) string {
	return c.keyPrefix + revokedTombstoneSuffix + sid
}

// BumpSessionEpoch raises the local floor and (write-through) the shared
// Redis floor. Shared write is best-effort: the caller (revoke subscriber)
// logs the error; the next revoke event re-writes it.
func (c *EpochCache) BumpSessionEpoch(ctx context.Context, sid string, epoch int64) error {
	sid = trim(sid)
	if sid == "" || epoch <= 0 {
		return nil
	}
	c.mu.Lock()
	if prev, ok := c.sessions[sid]; !ok || epoch > prev {
		c.sessions[sid] = epoch
	}
	c.mu.Unlock()
	if c.rdb == nil {
		return nil
	}
	wctx, cancel := context.WithTimeout(ctx, sharedOpTimeout)
	defer cancel()
	return c.rdb.Set(wctx, c.epochFloorKey(sid), epoch, sharedFloorTTL).Err()
}

// BumpDeviceEpoch stays local-only: revoke events carry only sessionEpoch;
// device_epoch is consulted solely at gateway mint time (PG lookup).
func (c *EpochCache) BumpDeviceEpoch(authDeviceID string, epoch int64) {
	id := trim(authDeviceID)
	if id == "" || epoch <= 0 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if prev, ok := c.devices[id]; !ok || epoch > prev {
		c.devices[id] = epoch
	}
}

// MarkSessionRevoked tombstones the sid locally and in shared Redis so every
// replica rejects the session even after a restart.
func (c *EpochCache) MarkSessionRevoked(ctx context.Context, sid string) error {
	sid = trim(sid)
	if sid == "" {
		return nil
	}
	c.mu.Lock()
	c.revokedSids[sid] = struct{}{}
	c.mu.Unlock()
	if c.rdb == nil {
		return nil
	}
	wctx, cancel := context.WithTimeout(ctx, sharedOpTimeout)
	defer cancel()
	return c.rdb.Set(wctx, c.revokedKey(sid), 1, sharedFloorTTL).Err()
}

// IsSessionRevoked checks the local tombstone first, then shared Redis.
// A Redis error fails open in ACCEPT mode semantics: the caller logs and
// treats the session as not revoked (same as the pre-shared-cache behaviour).
func (c *EpochCache) IsSessionRevoked(ctx context.Context, sid string) (bool, error) {
	sid = trim(sid)
	if sid == "" {
		return false, nil
	}
	c.mu.RLock()
	_, ok := c.revokedSids[sid]
	c.mu.RUnlock()
	if ok {
		return true, nil
	}
	if c.rdb == nil {
		return false, nil
	}
	rctx, cancel := context.WithTimeout(ctx, sharedOpTimeout)
	defer cancel()
	err := c.rdb.Get(rctx, c.revokedKey(sid)).Err()
	if errors.Is(err, redis.Nil) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	c.mu.Lock()
	c.revokedSids[sid] = struct{}{}
	c.mu.Unlock()
	return true, nil
}

// SessionEpochStale: local floor short-circuits; on a local miss the shared
// Redis floor decides, so a freshly restarted replica enforces the same
// floor as its peers.
func (c *EpochCache) SessionEpochStale(ctx context.Context, sid string, tokenEpoch int64) (bool, error) {
	sid = trim(sid)
	if sid == "" {
		return false, nil
	}
	c.mu.RLock()
	floor, ok := c.sessions[sid]
	c.mu.RUnlock()
	if ok && floor > tokenEpoch {
		return true, nil
	}
	if c.rdb == nil {
		return ok && floor > tokenEpoch, nil
	}
	rctx, cancel := context.WithTimeout(ctx, sharedOpTimeout)
	defer cancel()
	sharedFloor, err := c.rdb.Get(rctx, c.epochFloorKey(sid)).Int64()
	if errors.Is(err, redis.Nil) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if sharedFloor > 0 {
		c.mu.Lock()
		if prev, ok := c.sessions[sid]; !ok || sharedFloor > prev {
			c.sessions[sid] = sharedFloor
		}
		c.mu.Unlock()
	}
	return sharedFloor > tokenEpoch, nil
}

// DeviceEpochStale is local-only (see BumpDeviceEpoch).
func (c *EpochCache) DeviceEpochStale(authDeviceID string, tokenEpoch int64) bool {
	id := trim(authDeviceID)
	if id == "" {
		return false
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	floor, ok := c.devices[id]
	return ok && floor > tokenEpoch
}

func trim(v string) string {
	for len(v) > 0 && (v[0] == ' ' || v[0] == '\t') {
		v = v[1:]
	}
	for len(v) > 0 {
		last := v[len(v)-1]
		if last != ' ' && last != '\t' {
			break
		}
		v = v[:len(v)-1]
	}
	return v
}
