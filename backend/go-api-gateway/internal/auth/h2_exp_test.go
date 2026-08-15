package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/golang-jwt/jwt/v5"
)

func signTokenForTest(t *testing.T, secret string, claims jwt.MapClaims) string {
	t.Helper()
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return signed
}

// TestH2VerifyAccessRequiresExp: an access token with a valid signature but no
// exp claim must never validate (H-2 defense-in-depth).
func TestVerifyAccessRequiresExp(t *testing.T) {
	m := &SessionManager{jwtSecret: "test-secret-test-secret-test-secret-32"}

	noExp := signTokenForTest(t, m.jwtSecret, jwt.MapClaims{
		"type":   "access",
		"userId": "9",
	})
	if ok, _ := m.verifyAccess(noExp); ok {
		t.Fatal("access token without exp accepted — must be rejected")
	}

	withExp := signTokenForTest(t, m.jwtSecret, jwt.MapClaims{
		"type":   "access",
		"userId": "9",
		"exp":    time.Now().Add(time.Hour).Unix(),
	})
	if ok, _ := m.verifyAccess(withExp); !ok {
		t.Fatal("access token with exp rejected")
	}

	expired := signTokenForTest(t, m.jwtSecret, jwt.MapClaims{
		"type":   "access",
		"userId": "9",
		"exp":    time.Now().Add(-time.Hour).Unix(),
	})
	if ok, _ := m.verifyAccess(expired); ok {
		t.Fatal("expired access token accepted")
	}
}

// TestH2ProofAccessTokenRequiresExp: a proof-access token without exp is
// rejected even though it is signed and otherwise valid.
func TestProofAccessTokenRequiresExp(t *testing.T) {
	t.Setenv(envProofAccessTokenEnabled, "1")

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()
	sid := "sid_12345678901234567890"
	authDeviceID := "adev_1234567890123456789"
	_, pub := generateTestECDSAKeyPair(t)
	manager := newProofTestManager(t, mr, sid, authDeviceID, pub, 9)
	manager.proofEpochs = newProofEpochCache()

	token := signTokenForTest(t, manager.jwtSecret, jwt.MapClaims{
		"type":         proofAccessTokenType,
		"sid":          sid,
		"authDeviceId": authDeviceID,
		"sessionEpoch": float64(0),
		"deviceEpoch":  float64(0),
		"iat":          time.Now().Unix(),
		// no exp
	})

	req := httptest.NewRequest(http.MethodGet, "/api/profile", nil)
	req.AddCookie(&http.Cookie{Name: "mp_sid", Value: sid})
	req.Header.Set(headerAuthDeviceID, authDeviceID)
	req.Header.Set(headerProofAccessToken, token)
	w := httptest.NewRecorder()
	manager.SessionAuthMiddleware()(manager.DeviceProofMiddleware()(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))).ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("exp-less proof token = %d, want 401", w.Code)
	}
}
