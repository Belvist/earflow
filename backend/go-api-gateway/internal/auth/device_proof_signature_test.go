package auth

import (
	"crypto/sha256"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
)

// Contract: browser Web Crypto (P1363) and Go test signer (DER) must both verify.
func TestVerifyECDSAP256Signature_AcceptsDERAndP1363(t *testing.T) {
	priv, pubSPKI := generateTestECDSAKeyPair(t)
	pub, err := parseECDSAPublicKeySPKI(pubSPKI)
	if err != nil {
		t.Fatal(err)
	}

	canonical := buildCanonicalProofString(http.MethodGet, "/api/profile", nil, "1710000000", "nonce-sig-contract", "sidhash-contract")
	digest := sha256.Sum256([]byte(canonical))

	derProof := signCanonicalTest(t, priv, canonical)
	if !verifyECDSAP256Signature(pub, digest[:], derProof) {
		t.Fatal("ASN.1 DER signature must verify")
	}

	p1363Proof := signCanonicalP1363Test(t, priv, canonical)
	if !verifyECDSAP256Signature(pub, digest[:], p1363Proof) {
		t.Fatal("IEEE P1363 (64-byte) signature must verify (Web Crypto / Playwright)")
	}

	if derProof == p1363Proof {
		t.Fatal("DER and P1363 encodings must differ for same canonical input")
	}
}

func TestVerifyECDSAP256Signature_RejectsGarbage(t *testing.T) {
	_, pubSPKI := generateTestECDSAKeyPair(t)
	pub, err := parseECDSAPublicKeySPKI(pubSPKI)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256([]byte("canonical"))
	if verifyECDSAP256Signature(pub, digest[:], "not-a-valid-signature") {
		t.Fatal("invalid signature must not verify")
	}
}

func TestDeviceProofMiddleware_AcceptsP1363BrowserFormat(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	sid := "sid_12345678901234567890"
	authDeviceID := "adev_1234567890123456789"
	priv, pub := generateTestECDSAKeyPair(t)
	manager := newProofTestManager(t, mr, sid, authDeviceID, pub, 9)

	ts := strconv.FormatInt(time.Now().Unix(), 10)
	nonce := "nonce-browser-p1363-01"
	canonical := buildCanonicalProofString(http.MethodGet, "/api/profile", nil, ts, nonce, sidHashForProof(manager.jwtSecret, sid))
	proof := signCanonicalP1363Test(t, priv, canonical)

	req := httptest.NewRequest(http.MethodGet, "/api/profile", nil)
	req.Header.Set("Origin", "https://earflow.ru")
	req.AddCookie(&http.Cookie{Name: "mp_sid", Value: sid})
	req.Header.Set(headerAuthDeviceID, authDeviceID)
	req.Header.Set(headerAuthDeviceProof, proof)
	req.Header.Set(headerAuthDeviceTs, ts)
	req.Header.Set(headerAuthDeviceNonce, nonce)

	w := httptest.NewRecorder()
	handler := manager.SessionAuthMiddleware()(manager.DeviceProofMiddleware()(http.HandlerFunc(manager.handleProfile())))
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("P1363 signed profile status = %d, want 200 body=%s", w.Code, w.Body.String())
	}
}
