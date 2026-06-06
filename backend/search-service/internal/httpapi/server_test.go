package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/earflow/music-platform/search-service/internal/observability"
)

func TestServerExposesMetricsForAuthenticatedEmptySearch(t *testing.T) {
	metrics := observability.NewMetrics()
	srv := NewServer(ServerConfig{
		Addr:           ":0",
		PublicMaxLimit: 12,
		AuthedMaxLimit: 20,
		RequestTimeout: 2 * time.Second,
		Metrics:        metrics,
	})

	searchReq := httptest.NewRequest(http.MethodGet, "/api/search/v1?q=", nil)
	searchReq.Header.Set("X-User-Id", "user-123")
	searchRes := httptest.NewRecorder()
	srv.Handler.ServeHTTP(searchRes, searchReq)

	if searchRes.Code != http.StatusOK {
		t.Fatalf("search status = %d, want %d, body=%s", searchRes.Code, http.StatusOK, searchRes.Body.String())
	}

	metricsReq := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	metricsRes := httptest.NewRecorder()
	srv.Handler.ServeHTTP(metricsRes, metricsReq)

	if metricsRes.Code != http.StatusOK {
		t.Fatalf("metrics status = %d, want %d, body=%s", metricsRes.Code, http.StatusOK, metricsRes.Body.String())
	}

	body := metricsRes.Body.String()
	for _, want := range []string{
		"search_query_requests_total",
		`authed="true"`,
		`outcome="empty"`,
		"search_http_requests_total",
		`route="search_v1"`,
		`status="200"`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("metrics body does not contain %q\n%s", want, body)
		}
	}
}
