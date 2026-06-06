package searchwall

import (
	"sync"
	"time"

	"github.com/earflow/music-platform/search-service/internal/textnorm"
)

type entry struct {
	q  string
	at time.Time
}

type identityState struct {
	lastSeen time.Time
	entries  []entry
}

type Throttler struct {
	mu   sync.Mutex
	cfg  Config
	data map[string]*identityState
}

func NewThrottler(cfg Config) *Throttler {
	return &Throttler{cfg: cfg, data: map[string]*identityState{}}
}

type throttleLimits struct {
	window     time.Duration
	maxUnique  int
	maxEntries int
	ttl        time.Duration
}

func (t *Throttler) limits() throttleLimits {
	window := t.cfg.Window
	if window <= 0 {
		window = 1100 * time.Millisecond
	}
	maxUnique := t.cfg.MaxUniquePerWindow
	if maxUnique <= 0 {
		maxUnique = 8
	}
	maxEntries := t.cfg.MaxWindowEntries
	if maxEntries <= 0 {
		maxEntries = 32
	}
	ttl := t.cfg.EntryTTL
	if ttl <= 0 {
		ttl = 3 * time.Minute
	}
	return throttleLimits{window: window, maxUnique: maxUnique, maxEntries: maxEntries, ttl: ttl}
}

func pruneWindow(entries []entry, start time.Time) []entry {
	kept := entries[:0]
	for _, e := range entries {
		if e.at.After(start) {
			kept = append(kept, e)
		}
	}
	return kept
}

func isTyping(prev, next string) bool {
	if prev == "" || next == "" {
		return false
	}
	if len(prev) < 2 || len(next) < 2 {
		return false
	}
	if len(next) >= len(prev) {
		return next[:len(prev)] == prev
	}
	return prev[:len(next)] == next
}

func appendBounded(entries []entry, maxEntries int, e entry) []entry {
	if maxEntries <= 0 {
		maxEntries = 32
	}
	if len(entries) < maxEntries {
		return append(entries, e)
	}
	copy(entries, entries[1:])
	entries[len(entries)-1] = e
	return entries
}

func uniqueCount(entries []entry) int {
	seen := map[string]struct{}{}
	unique := 0
	for _, e := range entries {
		if e.q == "" {
			continue
		}
		if _, ok := seen[e.q]; ok {
			continue
		}
		seen[e.q] = struct{}{}
		unique++
	}
	return unique
}

func gcIfNeeded(data map[string]*identityState, ttl time.Duration, now time.Time) {
	if len(data) <= 5000 {
		return
	}
	cutoff := now.Add(-ttl)
	for k, v := range data {
		if v == nil || v.lastSeen.Before(cutoff) {
			delete(data, k)
		}
	}
}

func (t *Throttler) Allow(id string, rawQuery string, now time.Time) bool {
	key := id
	if key == "" {
		key = "anon"
	}
	q := textnorm.NormalizeQuery(rawQuery)
	lim := t.limits()
	start := now.Add(-lim.window)

	t.mu.Lock()
	defer t.mu.Unlock()

	st := t.data[key]
	if st == nil {
		st = &identityState{lastSeen: now, entries: make([]entry, 0, 8)}
		t.data[key] = st
	}
	st.lastSeen = now
	st.entries = pruneWindow(st.entries, start)

	var prev string
	if len(st.entries) > 0 {
		prev = st.entries[len(st.entries)-1].q
	}

	if q != "" {
		st.entries = appendBounded(st.entries, lim.maxEntries, entry{q: q, at: now})
	}

	if isTyping(prev, q) {
		return true
	}

	if q == "" {
		return true
	}
	if uniqueCount(st.entries) > lim.maxUnique {
		return false
	}
	gcIfNeeded(t.data, lim.ttl, now)

	return true
}
