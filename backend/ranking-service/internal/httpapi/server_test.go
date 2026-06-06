package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ranking-service/internal/observability"
	"ranking-service/internal/ranking"
)

func TestRankEndpointRecordsMetrics(t *testing.T) {
	metrics := observability.NewMetrics()
	handler := NewHandler(ServerConfig{MaxBodyBytes: 1024, Metrics: metrics})

	body := []byte(`{"limit":1,"candidates":[{"id":1,"artist":"alpha","popularity":10,"sourceScore":0.1},{"id":2,"artist":"beta","popularity":80,"sourceScore":1.0}]}`)
	rankReq := httptest.NewRequest(http.MethodPost, "/rank", bytes.NewReader(body))
	rankReq.Header.Set("Content-Type", "application/json")
	rankRes := httptest.NewRecorder()
	handler.ServeHTTP(rankRes, rankReq)

	if rankRes.Code != http.StatusOK {
		t.Fatalf("rank status = %d, want %d, body=%s", rankRes.Code, http.StatusOK, rankRes.Body.String())
	}

	var resp ranking.Response
	if err := json.NewDecoder(rankRes.Body).Decode(&resp); err != nil {
		t.Fatalf("decode rank response: %v", err)
	}
	if len(resp.Ranked) != 1 || resp.Ranked[0].ID != 2 {
		t.Fatalf("rank response = %+v, want id 2", resp.Ranked)
	}

	metricsReq := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	metricsRes := httptest.NewRecorder()
	handler.ServeHTTP(metricsRes, metricsReq)

	if metricsRes.Code != http.StatusOK {
		t.Fatalf("metrics status = %d, want %d, body=%s", metricsRes.Code, http.StatusOK, metricsRes.Body.String())
	}

	metricsBody := metricsRes.Body.String()
	for _, want := range []string{
		"ranking_rank_requests_total",
		`outcome="ok"`,
		"ranking_rank_candidates_total",
		`phase="input"`,
		`phase="ranked"`,
		"ranking_http_requests_total",
		`route="rank"`,
		`status="200"`,
	} {
		if !strings.Contains(metricsBody, want) {
			t.Fatalf("metrics body does not contain %q\n%s", want, metricsBody)
		}
	}
}
