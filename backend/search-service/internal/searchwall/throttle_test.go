package searchwall

import (
	"fmt"
	"testing"
	"time"
)

func TestThrottlerAllowsConfiguredUniqueCount(t *testing.T) {
	th := NewThrottler(Config{
		MaxUniquePerWindow: 3,
		Window:             time.Second,
		MaxWindowEntries:   8,
		EntryTTL:           time.Minute,
	})

	now := time.Unix(1000, 0)
	for i := 0; i < 3; i++ {
		if !th.Allow("u:1", fmt.Sprintf("query-%d", i), now.Add(time.Duration(i)*time.Millisecond)) {
			t.Fatalf("query %d was throttled before configured limit", i)
		}
	}
	if th.Allow("u:1", "query-4", now.Add(4*time.Millisecond)) {
		t.Fatalf("query above configured limit was allowed")
	}
}
