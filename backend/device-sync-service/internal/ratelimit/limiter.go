// Package ratelimit provides a tiny per-key token bucket used by the WS
// message pump. For HTTP we rely on a dedicated chi middleware.
package ratelimit

import (
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// Bucket is a single rate.Limiter with a last-access timestamp, suitable for
// Sieve/LRU-style eviction by the parent Pool.
type Bucket struct {
	lim     *rate.Limiter
	lastUse int64 // unix nano
}

// Pool is a concurrent map of limiters keyed by an opaque string (e.g. IP or
// deviceID). It GC's unused buckets periodically so a big burst of unique
// keys does not grow memory unbounded.
type Pool struct {
	mu         sync.RWMutex
	buckets    map[string]*Bucket
	perSecond  int
	burst      int
	expireAge  time.Duration
	sweepEvery time.Duration
}

// NewPool builds a Pool. `perSecond` is tokens added per second; `burst`
// is the immediate bucket size. Pass burst>=perSecond so well-behaved clients
// never see spurious rejections.
func NewPool(perSecond, burst int) *Pool {
	if perSecond < 1 {
		perSecond = 1
	}
	if burst < perSecond {
		burst = perSecond
	}
	return &Pool{
		buckets:    make(map[string]*Bucket, 1024),
		perSecond:  perSecond,
		burst:      burst,
		expireAge:  5 * time.Minute,
		sweepEvery: 2 * time.Minute,
	}
}

// Allow returns true if the key is under its rate limit right now.
// Safe for concurrent use.
func (p *Pool) Allow(key string) bool {
	if key == "" {
		return true
	}
	p.mu.RLock()
	b, ok := p.buckets[key]
	p.mu.RUnlock()
	if !ok {
		p.mu.Lock()
		b, ok = p.buckets[key]
		if !ok {
			b = &Bucket{
				lim: rate.NewLimiter(rate.Limit(p.perSecond), p.burst),
			}
			p.buckets[key] = b
		}
		p.mu.Unlock()
	}
	b.lastUse = time.Now().UnixNano()
	return b.lim.Allow()
}

// Forget removes a key immediately. Call from WS cleanup.
func (p *Pool) Forget(key string) {
	if key == "" {
		return
	}
	p.mu.Lock()
	delete(p.buckets, key)
	p.mu.Unlock()
}

// RunSweeper starts a background sweeper which drops idle buckets. Must be
// called once per Pool; returns a stop func.
func (p *Pool) RunSweeper() (stop func()) {
	done := make(chan struct{})
	go func() {
		t := time.NewTicker(p.sweepEvery)
		defer t.Stop()
		for {
			select {
			case <-done:
				return
			case now := <-t.C:
				p.sweep(now.UnixNano() - int64(p.expireAge))
			}
		}
	}()
	return func() { close(done) }
}

func (p *Pool) sweep(cutoff int64) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for k, b := range p.buckets {
		if b.lastUse < cutoff {
			delete(p.buckets, k)
		}
	}
}
