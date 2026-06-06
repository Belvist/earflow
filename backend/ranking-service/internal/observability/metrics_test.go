package observability

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRecordHomeExposesComposerMetrics(t *testing.T) {
	metrics := NewMetrics()
	metrics.RecordHome(
		"ok",
		"generated",
		"bypass_personalized",
		true,
		1,
		2,
		map[string]int{"exact": 4, "fresh": 3},
		map[string]int{"recent": 2, "skip": 1},
	)

	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	res := httptest.NewRecorder()
	metrics.Handler().ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("metrics status = %d, want %d", res.Code, http.StatusOK)
	}
	body := res.Body.String()
	for _, want := range []string{
		"ranking_home_requests_total",
		`outcome="ok"`,
		`source="generated"`,
		"ranking_home_cache_events_total",
		`status="bypass_personalized"`,
		"ranking_home_fallback_events_total",
		`status="used"`,
		"ranking_home_bucket_tracks_total",
		`bucket="exact"`,
		`bucket="fresh"`,
		"ranking_home_realtime_matches_total",
		`type="recent"`,
		`type="skip"`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("metrics body does not contain %q\n%s", want, body)
		}
	}
}
