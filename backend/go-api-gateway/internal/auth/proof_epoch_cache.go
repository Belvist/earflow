package auth

import (
	"strings"
	"sync"
)

type proofEpochCache struct {
	sessions sync.Map // sid -> int64 session epoch floor
	devices  sync.Map // authDeviceId -> int64 device epoch floor
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
	for {
		prevAny, loaded := c.sessions.Load(sid)
		if loaded {
			prev, ok := prevAny.(int64)
			if ok && prev >= epoch {
				return
			}
		}
		if !loaded {
			c.sessions.Store(sid, epoch)
			return
		}
		if c.sessions.CompareAndSwap(sid, prevAny, epoch) {
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
	for {
		prevAny, loaded := c.devices.Load(authDeviceID)
		if loaded {
			prev, ok := prevAny.(int64)
			if ok && prev >= epoch {
				return
			}
		}
		if !loaded {
			c.devices.Store(authDeviceID, epoch)
			return
		}
		if c.devices.CompareAndSwap(authDeviceID, prevAny, epoch) {
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
			sessionEpoch, _ = v.(int64)
		}
	}
	if authDeviceID != "" {
		if v, ok := c.devices.Load(authDeviceID); ok {
			deviceEpoch, _ = v.(int64)
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
	prev, ok := prevAny.(int64)
	return ok && prev > tokenEpoch
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
	prev, ok := prevAny.(int64)
	return ok && prev > tokenEpoch
}
