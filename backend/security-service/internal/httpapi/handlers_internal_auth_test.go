package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/earflow/music-platform/security-service/internal/config"
	"github.com/earflow/music-platform/security-service/internal/store"
	"github.com/earflow/music-platform/security-service/internal/store/authpg"
)

func TestInternalSessionUpsert_DisabledWithoutDualWrite(t *testing.T) {
	d := Deps{
		Config: config.Config{
			HTTP:                config.HTTPConfig{MaxBodyBytes: 4096},
			ServiceKeyGateway:   "test-key-32chars-minimum-length!!",
		},
		AuthSoT: &store.AuthSoT{Mode: authpg.ModeOff},
	}
	body, _ := json.Marshal(map[string]any{"sid": "sid_12345678901234567890", "userId": 1})
	req := httptest.NewRequest(http.MethodPost, "/internal/auth/v1/sessions/upsert", bytes.NewReader(body))
	req.Header.Set("X-Service-Token", "test-key-32chars-minimum-length!!")
	w := httptest.NewRecorder()
	internalSessionUpsertHandler(d)(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}
