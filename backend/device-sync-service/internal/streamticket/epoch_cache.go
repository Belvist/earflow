package streamticket

import (
	"sync"
)

// EpochCache tracks session/device epoch floors and revoked sids (SEC-005 local cache).
type EpochCache struct {
	mu           sync.RWMutex
	sessions     map[string]int64
	devices      map[string]int64
	revokedSids  map[string]struct{}
}

func NewEpochCache() *EpochCache {
	return &EpochCache{
		sessions:    make(map[string]int64),
		devices:     make(map[string]int64),
		revokedSids: make(map[string]struct{}),
	}
}

func (c *EpochCache) BumpSessionEpoch(sid string, epoch int64) {
	sid = trim(sid)
	if sid == "" || epoch <= 0 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if prev, ok := c.sessions[sid]; !ok || epoch > prev {
		c.sessions[sid] = epoch
	}
}

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

func (c *EpochCache) MarkSessionRevoked(sid string) {
	sid = trim(sid)
	if sid == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.revokedSids[sid] = struct{}{}
}

func (c *EpochCache) IsSessionRevoked(sid string) bool {
	sid = trim(sid)
	if sid == "" {
		return false
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	_, ok := c.revokedSids[sid]
	return ok
}

func (c *EpochCache) SessionEpochStale(sid string, tokenEpoch int64) bool {
	sid = trim(sid)
	if sid == "" {
		return false
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	floor, ok := c.sessions[sid]
	return ok && floor > tokenEpoch
}

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
