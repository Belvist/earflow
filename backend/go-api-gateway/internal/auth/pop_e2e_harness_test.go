//go:build pop_e2e_harness

package auth

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

func TestPopE2EHarnessFlow_GoSigner(t *testing.T) {
	t.Setenv("POP_E2E_PORT", "0")
	h, err := StartPopE2EHarness(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer h.Close()

	priv, pub := generateTestECDSAKeyPair(t)
	authDeviceID := "adev_e2e_harness_go_signer01"

	seedReq := httptest.NewRequest(http.MethodPost, "/e2e/seed-session", nil)
	seedW := httptest.NewRecorder()
	h.handleSeedSession(seedW, seedReq)
	if seedW.Code != http.StatusOK {
		t.Fatalf("seed status=%d body=%s", seedW.Code, seedW.Body.String())
	}
	seedResp := seedW.Result()
	cookies := seedResp.Cookies()
	var sid string
	for _, c := range cookies {
		if c.Name == "mp_sid" {
			sid = c.Value
		}
	}
	if sid == "" {
		t.Fatal("missing mp_sid cookie after seed")
	}

	csrf := ""
	for _, c := range cookies {
		if c.Name == "mp_csrf" {
			csrf = c.Value
		}
	}

	regBody, _ := json.Marshal(map[string]string{
		"authDeviceId":  authDeviceID,
		"publicKeySpki": pub,
	})
	regReq := httptest.NewRequest(http.MethodPost, "/api/auth/device/register", bytes.NewReader(regBody))
	regReq.Header.Set("Origin", h.BaseURL)
	regReq.Header.Set("Content-Type", "application/json")
	regReq.Header.Set("X-CSRF-Token", csrf)
	for _, c := range cookies {
		regReq.AddCookie(c)
	}
	regW := httptest.NewRecorder()
	h.Server.Handler.ServeHTTP(regW, regReq)
	if regW.Code != http.StatusOK {
		t.Fatalf("register status=%d body=%s", regW.Code, regW.Body.String())
	}

	ts := strconv.FormatInt(time.Now().Unix(), 10)
	nonce := "nonce-harness-go-01"
	sidHash := sidHashForProof(popE2EJWTSecret, sid)
	canonical := buildCanonicalProofString(http.MethodGet, "/api/profile", nil, ts, nonce, sidHash)
	proof := signCanonicalTest(t, priv, canonical)

	profReq := httptest.NewRequest(http.MethodGet, "/api/profile", nil)
	profReq.Header.Set("Origin", h.BaseURL)
	profReq.Header.Set("X-Auth-Device-Id", authDeviceID)
	profReq.Header.Set("X-Auth-Device-Proof", proof)
	profReq.Header.Set("X-Auth-Device-Proof-Ts", ts)
	profReq.Header.Set("X-Auth-Device-Proof-Nonce", nonce)
	for _, c := range cookies {
		profReq.AddCookie(c)
	}
	profW := httptest.NewRecorder()
	h.Server.Handler.ServeHTTP(profW, profReq)
	if profW.Code != http.StatusOK {
		t.Fatalf("profile status=%d body=%s", profW.Code, profW.Body.String())
	}
}
