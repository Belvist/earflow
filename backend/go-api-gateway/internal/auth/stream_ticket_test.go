package auth

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/golang-jwt/jwt/v5"
)

func streamTicketMintBody(kind, sessionID, trackID, deviceID string) []byte {
	req := streamTicketMintRequest{
		Kind:   kind,
		Client: "web",
		Scope: streamTicketScope{
			SessionID: sessionID,
			TrackID:   trackID,
			DeviceID:  deviceID,
		},
	}
	b, _ := json.Marshal(req)
	return b
}

func TestStreamTicketDisabledReturns404(t *testing.T) {
	t.Setenv(envStreamTicketEnabled, "0")
	t.Setenv(envProofAccessTokenEnabled, "1")

	mr, _ := miniredis.Run()
	defer mr.Close()
	sid := "sid_12345678901234567890"
	authDeviceID := "adev_1234567890123456789"
	_, pub := generateTestECDSAKeyPair(t)
	manager := newProofTestManager(t, mr, sid, authDeviceID, pub, 9)
	manager.proofEpochs = newProofEpochCache()
	manager.allowedOrigins = map[string]struct{}{"https://earflow.ru": {}}

	token, _, err := manager.issueProofAccessToken(sid, authDeviceID, ProofEpochLookup{}, "")
	if err != nil {
		t.Fatalf("issue proof token: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/auth/stream-ticket", bytes.NewReader(streamTicketMintBody("media", "sess1", "track1", "")))
	req.AddCookie(&http.Cookie{Name: "mp_sid", Value: sid})
	req.Header.Set("Origin", "https://earflow.ru")
	req.Header.Set(headerAuthDeviceID, authDeviceID)
	req.Header.Set(headerProofAccessToken, token)
	w := httptest.NewRecorder()
	chain := manager.SessionAuthMiddleware()(manager.DeviceProofMiddleware()(manager.handleStreamTicket()))
	chain.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("disabled status = %d, want 404", w.Code)
	}
}

func TestStreamTicketMediaWithProofAccessToken(t *testing.T) {
	t.Setenv(envStreamTicketEnabled, "1")
	t.Setenv(envProofAccessTokenEnabled, "1")

	mr, _ := miniredis.Run()
	defer mr.Close()
	sid := "sid_12345678901234567890"
	authDeviceID := "adev_1234567890123456789"
	_, pub := generateTestECDSAKeyPair(t)
	manager := newProofTestManager(t, mr, sid, authDeviceID, pub, 9)
	manager.proofEpochs = newProofEpochCache()
	manager.allowedOrigins = map[string]struct{}{"https://earflow.ru": {}}

	manager.proofEpochs.remember(sid, authDeviceID, 2, 3)

	token, _, err := manager.issueProofAccessToken(sid, authDeviceID, ProofEpochLookup{SessionEpoch: 2, DeviceEpoch: 3}, "")
	if err != nil {
		t.Fatalf("issue proof token: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/auth/stream-ticket", bytes.NewReader(streamTicketMintBody("media", "sess_abc", "track_xyz", "")))
	req.AddCookie(&http.Cookie{Name: "mp_sid", Value: sid})
	req.Header.Set("Origin", "https://earflow.ru")
	req.Header.Set(headerAuthDeviceID, authDeviceID)
	req.Header.Set(headerProofAccessToken, token)
	w := httptest.NewRecorder()
	chain := manager.SessionAuthMiddleware()(manager.DeviceProofMiddleware()(manager.handleStreamTicket()))
	chain.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("media mint status = %d, want 200 body=%s", w.Code, w.Body.String())
	}

	var resp streamTicketMintResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.TicketType != streamTicketTypeMedia || resp.Transport != "query" || resp.Ticket == "" {
		t.Fatalf("bad response: %+v", resp)
	}
	if resp.ExpiresIn <= 0 {
		t.Fatalf("expiresIn = %d", resp.ExpiresIn)
	}

	raw, err := mr.Get(opaqueStreamTicketRedisKey(resp.Ticket))
	if err != nil {
		t.Fatalf("redis get: %v", err)
	}
	var rec opaqueStreamTicketRecord
	if err := json.Unmarshal([]byte(raw), &rec); err != nil {
		t.Fatal(err)
	}
	if rec.SessionEpoch != 2 || rec.DeviceEpoch != 3 || rec.Scope.SessionID != "sess_abc" {
		t.Fatalf("bad stored record: %+v", rec)
	}
}

func TestStreamTicketStreamSessionJWT(t *testing.T) {
	t.Setenv(envStreamTicketEnabled, "1")
	t.Setenv(envProofAccessTokenEnabled, "1")

	mr, _ := miniredis.Run()
	defer mr.Close()
	sid := "sid_12345678901234567890"
	authDeviceID := "adev_1234567890123456789"
	_, pub := generateTestECDSAKeyPair(t)
	manager := newProofTestManager(t, mr, sid, authDeviceID, pub, 9)
	manager.proofEpochs = newProofEpochCache()
	manager.allowedOrigins = map[string]struct{}{"https://earflow.ru": {}}

	token, _, _ := manager.issueProofAccessToken(sid, authDeviceID, ProofEpochLookup{SessionEpoch: 1}, "")
	req := httptest.NewRequest(http.MethodPost, "/api/auth/stream-ticket", bytes.NewReader(streamTicketMintBody("stream_session", "sess1", "track1", "")))
	req.AddCookie(&http.Cookie{Name: "mp_sid", Value: sid})
	req.Header.Set("Origin", "https://earflow.ru")
	req.Header.Set(headerAuthDeviceID, authDeviceID)
	req.Header.Set(headerProofAccessToken, token)
	w := httptest.NewRecorder()
	manager.SessionAuthMiddleware()(manager.DeviceProofMiddleware()(manager.handleStreamTicket())).ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	var resp streamTicketMintResponse
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.TicketType != streamTicketTypeSession || resp.Transport != "header" {
		t.Fatalf("bad response: %+v", resp)
	}

	parser := jwt.NewParser(jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
	claims := jwt.MapClaims{}
	_, err := parser.ParseWithClaims(resp.Ticket, claims, func(t *jwt.Token) (any, error) {
		return []byte(manager.jwtSecret), nil
	})
	if err != nil {
		t.Fatalf("parse jwt: %v", err)
	}
	if typ, _ := claims["type"].(string); typ != streamTicketJWTTypeSession {
		t.Fatalf("jwt type = %q", typ)
	}
}

func TestStreamTicketWSRequiresFullProof(t *testing.T) {
	t.Setenv(envStreamTicketEnabled, "1")
	t.Setenv(envProofAccessTokenEnabled, "1")

	mr, _ := miniredis.Run()
	defer mr.Close()
	sid := "sid_12345678901234567890"
	authDeviceID := "adev_1234567890123456789"
	_, pub := generateTestECDSAKeyPair(t)
	manager := newProofTestManager(t, mr, sid, authDeviceID, pub, 9)
	manager.proofEpochs = newProofEpochCache()
	manager.allowedOrigins = map[string]struct{}{"https://earflow.ru": {}}

	token, _, _ := manager.issueProofAccessToken(sid, authDeviceID, ProofEpochLookup{}, "")
	req := httptest.NewRequest(http.MethodPost, "/api/auth/stream-ticket", bytes.NewReader(streamTicketMintBody("ws", "", "", "dev1")))
	req.AddCookie(&http.Cookie{Name: "mp_sid", Value: sid})
	req.Header.Set("Origin", "https://earflow.ru")
	req.Header.Set(headerAuthDeviceID, authDeviceID)
	req.Header.Set(headerProofAccessToken, token)
	w := httptest.NewRecorder()
	manager.SessionAuthMiddleware()(manager.DeviceProofMiddleware()(manager.handleStreamTicket())).ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("ws with proof token only = %d, want 401", w.Code)
	}
}

func TestStreamTicketWSWithFullProof(t *testing.T) {
	t.Setenv(envStreamTicketEnabled, "1")

	mr, _ := miniredis.Run()
	defer mr.Close()
	sid := "sid_12345678901234567890"
	authDeviceID := "adev_1234567890123456789"
	priv, pub := generateTestECDSAKeyPair(t)
	manager := newProofTestManager(t, mr, sid, authDeviceID, pub, 9)
	manager.proofEpochs = newProofEpochCache()
	manager.allowedOrigins = map[string]struct{}{"https://earflow.ru": {}}

	ts := strconv.FormatInt(time.Now().Unix(), 10)
	nonce := "nonce-stream-ws-01"
	canonical := buildCanonicalProofString(http.MethodPost, "/api/auth/stream-ticket", nil, ts, nonce, sidHashForProof(manager.jwtSecret, sid))
	proof := signCanonicalTest(t, priv, canonical)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/stream-ticket", bytes.NewReader(streamTicketMintBody("ws", "", "", "dev_sync_1")))
	req.AddCookie(&http.Cookie{Name: "mp_sid", Value: sid})
	req.Header.Set("Origin", "https://earflow.ru")
	req.Header.Set(headerAuthDeviceID, authDeviceID)
	req.Header.Set(headerAuthDeviceProof, proof)
	req.Header.Set(headerAuthDeviceTs, ts)
	req.Header.Set(headerAuthDeviceNonce, nonce)
	w := httptest.NewRecorder()
	manager.SessionAuthMiddleware()(manager.DeviceProofMiddleware()(manager.handleStreamTicket())).ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ws mint status = %d body=%s", w.Code, w.Body.String())
	}
	var resp streamTicketMintResponse
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.TicketType != streamTicketTypeWSConnect || resp.Transport != "query" {
		t.Fatalf("bad response: %+v", resp)
	}
	raw, _ := mr.Get(opaqueStreamTicketRedisKey(resp.Ticket))
	var rec opaqueStreamTicketRecord
	_ = json.Unmarshal([]byte(raw), &rec)
	if !rec.OneTime || rec.Scope.DeviceID != "dev_sync_1" {
		t.Fatalf("bad ws record: %+v", rec)
	}
}

func TestStreamTicketObserveEnabled(t *testing.T) {
	t.Setenv(envStreamTicketObserve, "1")
	if !streamTicketObserveEnabled() {
		t.Fatal("expected observe enabled")
	}
	t.Setenv(envStreamTicketObserve, "0")
	if streamTicketObserveEnabled() {
		t.Fatal("expected observe disabled")
	}
}

func TestValidateStreamTicketScopeRejectsMissingFields(t *testing.T) {
	if err := validateStreamTicketScope(streamTicketKindMedia, streamTicketScope{}); err == nil {
		t.Fatal("expected media scope error")
	}
	if err := validateStreamTicketScope(streamTicketKindWS, streamTicketScope{}); err == nil {
		t.Fatal("expected ws scope error")
	}
}
