package auth

import (
	"strings"
	"sync"
	"time"
)

// proofEpochEntry stores an epoch floor plus when it was last used, so stale
// floors can be garbage-collected (M-5). A floor only matters for tokens
// issued BEFORE the bump; those die with the token TTL (≤60s), so a floor
// that goes untouched past maxAge is dead weight and safe to drop.
type proofEpochEntry struct {
	epoch int64
	at    time.Time
}

type proofEpochCache struct {
	sessions sync.Map // sid -> proofEpochEntry session epoch floor
	devices  sync.Map // authDeviceId -> proofEpochEntry device epoch floor
}

func newProofEpochCache() *proofEpochCache {
	return &proofEpochCache{}
}

func (c *proofEpochCache) bumpSessionEpoch(sid string, epoch int64) {
	if c == nil || epoch <= 0 {
		return
	}
	sid = strings.TrimSpace(sid)
	if sid == "" {
		return
	}
	now := time.Now().UTC()
	for {
		prevAny, loaded := c.sessions.Load(sid)
		if loaded {
			prev, ok := prevAny.(proofEpochEntry)
			if ok && prev.epoch >= epoch {
				return
			}
		}
		if !loaded {
			c.sessions.Store(sid, proofEpochEntry{epoch: epoch, at: now})
			return
		}
		if c.sessions.CompareAndSwap(sid, prevAny, proofEpochEntry{epoch: epoch, at: now}) {
			return
		}
	}
}

func (c *proofEpochCache) bumpDeviceEpoch(authDeviceID string, epoch int64) {
	if c == nil || epoch <= 0 {
		return
	}
	authDeviceID = strings.TrimSpace(authDeviceID)
	if authDeviceID == "" {
		return
	}
	now := time.Now().UTC()
	for {
		prevAny, loaded := c.devices.Load(authDeviceID)
		if loaded {
			prev, ok := prevAny.(proofEpochEntry)
			if ok && prev.epoch >= epoch {
				return
			}
		}
		if !loaded {
			c.devices.Store(authDeviceID, proofEpochEntry{epoch: epoch, at: now})
			return
		}
		if c.devices.CompareAndSwap(authDeviceID, prevAny, proofEpochEntry{epoch: epoch, at: now}) {
			return
		}
	}
}

func (c *proofEpochCache) snapshot(sid, authDeviceID string) (sessionEpoch, deviceEpoch int64) {
	if c == nil {
		return 0, 0
	}
	sid = strings.TrimSpace(sid)
	authDeviceID = strings.TrimSpace(authDeviceID)
	if sid != "" {
		if v, ok := c.sessions.Load(sid); ok {
			if e, ok := v.(proofEpochEntry); ok {
				sessionEpoch = e.epoch
			}
		}
	}
	if authDeviceID != "" {
		if v, ok := c.devices.Load(authDeviceID); ok {
			if e, ok := v.(proofEpochEntry); ok {
				deviceEpoch = e.epoch
			}
		}
	}
	return sessionEpoch, deviceEpoch
}

func (c *proofEpochCache) remember(sid, authDeviceID string, sessionEpoch, deviceEpoch int64) {
	if c == nil {
		return
	}
	if sessionEpoch > 0 {
		c.bumpSessionEpoch(sid, sessionEpoch)
	}
	if deviceEpoch > 0 {
		c.bumpDeviceEpoch(authDeviceID, deviceEpoch)
	}
}

func (c *proofEpochCache) sessionEpochStale(sid string, tokenEpoch int64) bool {
	if c == nil {
		return false
	}
	sid = strings.TrimSpace(sid)
	if sid == "" {
		return false
	}
	prevAny, ok := c.sessions.Load(sid)
	if !ok {
		return false
	}
	prev, ok := prevAny.(proofEpochEntry)
	return ok && prev.epoch > tokenEpoch
}

func (c *proofEpochCache) deviceEpochStale(authDeviceID string, tokenEpoch int64) bool {
	if c == nil {
		return false
	}
	authDeviceID = strings.TrimSpace(authDeviceID)
	if authDeviceID == "" {
		return false
	}
	prevAny, ok := c.devices.Load(authDeviceID)
	if !ok {
		return false
	}
	prev, ok := prevAny.(proofEpochEntry)
	return ok && prev.epoch > tokenEpoch
}

// gc drops floors untouched for longer than maxAge (M-5). Floors only reject
// tokens issued before the bump; those expire with the token TTL, so an
// untouched floor past maxAge protects nothing.
func (c *proofEpochCache) gc(now time.Time, maxAge time.Duration) {
	if c == nil || maxAge <= 0 {
		return
	}
	c.sessions.Range(func(k, v any) bool {
		if e, ok := v.(proofEpochEntry); ok && now.Sub(e.at) > maxAge {
			c.sessions.Delete(k)
		}
		return true
	})
	c.devices.Range(func(k, v any) bool {
		if e, ok := v.(proofEpochEntry); ok && now.Sub(e.at) > maxAge {
			c.devices.Delete(k)
		}
		return true
	})
}
