package auth

import (
	"context"
	"errors"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	headerProofAccessToken     = "X-Auth-Proof-Access-Token"
	proofAccessTokenType       = "proof_access"
	claimProofAccessTokenIP    = "ip"
	envProofAccessTokenEnabled = "PROOF_ACCESS_TOKEN_ENABLED"
	envProofAccessTokenTTL     = "PROOF_ACCESS_TOKEN_TTL_SECONDS"
	defaultProofAccessTokenTTL = 60 * time.Second
)

type proofAccessTokenResponse struct {
	Token     string `json:"token"`
	ExpiresIn int64  `json:"expiresIn"`
	ExpiresAt string `json:"expiresAt"`
}

func proofAccessTokenEnabled() bool {
	v := strings.TrimSpace(os.Getenv(envProofAccessTokenEnabled))
	if v == "0" || strings.EqualFold(v, "false") {
		return false
	}
	return true
}

func proofAccessTokenTTL() time.Duration {
	raw := strings.TrimSpace(os.Getenv(envProofAccessTokenTTL))
	if raw == "" {
		return defaultProofAccessTokenTTL
	}
	sec, err := strconv.Atoi(raw)
	if err != nil || sec < 30 || sec > 120 {
		return defaultProofAccessTokenTTL
	}
	return time.Duration(sec) * time.Second
}

func deviceProofSensitivePath(path string) bool {
	path = strings.TrimSpace(path)
	switch path {
	case "/api/auth/logout", "/api/auth/refresh", "/api/auth/proof/token", "/api/auth/device/register":
		return true
	}
	if strings.HasPrefix(path, "/api/auth/sessions") {
		return true
	}
	if strings.HasPrefix(path, "/api/auth/password/change") {
		return true
	}
	if strings.HasPrefix(path, "/api/auth/security") {
		return true
	}
	if strings.HasPrefix(path, "/api/auth/2fa") {
		return true
	}
	if strings.HasPrefix(path, "/api/auth/telegram/unlink") {
		return true
	}
	return false
}

// DeviceProofSensitivePaths returns exact/prefix paths that always require full ECDSA proof.
func DeviceProofSensitivePaths() []string {
	return []string{
		"/api/auth/logout",
		"/api/auth/refresh",
		"/api/auth/proof/token",
		"/api/auth/device/register",
		"/api/auth/sessions/*",
		"/api/auth/password/change",
		"/api/auth/security/*",
		"/api/auth/2fa/*",
		"/api/auth/telegram/unlink",
	}
}

func (m *SessionManager) lookupProofEpochs(ctx context.Context, sid, authDeviceID string) (ProofEpochLookup, error) {
	if m != nil && m.sot != nil {
		epochs, err := m.sot.LookupProofEpochs(ctx, sid, authDeviceID)
		if err == nil {
			if m.proofEpochs != nil {
				m.proofEpochs.remember(sid, authDeviceID, epochs.SessionEpoch, epochs.DeviceEpoch)
			}
			return epochs, nil
		}
	}
	return ProofEpochLookup{}, errors.New("epoch lookup unavailable")
}

func (m *SessionManager) issueProofAccessToken(sid, authDeviceID string, epochs ProofEpochLookup, clientIP string) (string, time.Time, error) {
	if m == nil {
		return "", time.Time{}, errors.New("session manager unavailable")
	}
	ttl := proofAccessTokenTTL()
	now := time.Now().UTC()
	exp := now.Add(ttl)
	claims := jwt.MapClaims{
		"type":         proofAccessTokenType,
		"sid":          strings.TrimSpace(sid),
		"authDeviceId": strings.TrimSpace(authDeviceID),
		"sessionEpoch": epochs.SessionEpoch,
		"deviceEpoch":  epochs.DeviceEpoch,
		"iat":          now.Unix(),
		"exp":          exp.Unix(),
	}
	// H-4: bind the token to the client IP observed at mint time. A leaked
	// token replayed from another address is rejected (see
	// validateProofAccessToken). Empty IP → no binding (legacy/dev fallback).
	if ip := net.ParseIP(strings.TrimSpace(clientIP)); ip != nil {
		claims[claimProofAccessTokenIP] = ip.String()
	}
	if iss := strings.TrimSpace(m.jwtIssuer); iss != "" {
		claims["iss"] = iss
	}
	if aud := strings.TrimSpace(m.jwtAudience); aud != "" {
		claims["aud"] = aud
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(m.jwtSecret))
	if err != nil {
		return "", time.Time{}, err
	}
	if m.proofEpochs != nil {
		m.proofEpochs.remember(sid, authDeviceID, epochs.SessionEpoch, epochs.DeviceEpoch)
	}
	return signed, exp, nil
}

func (m *SessionManager) validateProofAccessToken(r *http.Request, sid string) error {
	if m == nil {
		return errDeviceProofInvalid
	}
	raw := strings.TrimSpace(r.Header.Get(headerProofAccessToken))
	if raw == "" {
		return errDeviceProofRequired
	}
	authDeviceID := strings.TrimSpace(r.Header.Get(headerAuthDeviceID))
	if authDeviceID == "" {
		return errDeviceProofRequired
	}

	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithExpirationRequired(), // H-2: exp must be present
	)
	mapClaims := jwt.MapClaims{}
	_, err := parser.ParseWithClaims(raw, mapClaims, func(t *jwt.Token) (any, error) {
		return []byte(m.jwtSecret), nil
	})
	if err != nil {
		return errDeviceProofInvalid
	}
	if typ, _ := mapClaims["type"].(string); strings.TrimSpace(typ) != proofAccessTokenType {
		return errDeviceProofInvalid
	}
	claimSID, _ := mapClaims["sid"].(string)
	if strings.TrimSpace(claimSID) != sid {
		return errDeviceProofInvalid
	}
	claimDevice, _ := mapClaims["authDeviceId"].(string)
	if strings.TrimSpace(claimDevice) != authDeviceID {
		return errDeviceProofInvalid
	}
	if !m.verifyIssuerAudience(mapClaims) {
		return errDeviceProofInvalid
	}
	// H-4: reject replays from a different client address. Tokens minted
	// before IP binding existed (≤90s after deploy) carry no claim → skip.
	if boundIP, ok := mapClaims[claimProofAccessTokenIP].(string); ok {
		if parsedBound := net.ParseIP(boundIP); parsedBound != nil {
			reqIP := net.ParseIP(strings.TrimSpace(clientIPFromRequest(r)))
			if reqIP == nil || !reqIP.Equal(parsedBound) {
				return errDeviceProofInvalid
			}
		}
	}
	sessionEpoch := int64Claim(mapClaims["sessionEpoch"])
	deviceEpoch := int64Claim(mapClaims["deviceEpoch"])
	if m.isSessionLocallyRevoked(sid) {
		return errDeviceProofInvalid
	}
	if m.proofEpochs != nil {
		if m.proofEpochs.sessionEpochStale(sid, sessionEpoch) {
			return errDeviceProofInvalid
		}
		if m.proofEpochs.deviceEpochStale(authDeviceID, deviceEpoch) {
			return errDeviceProofInvalid
		}
	}

	rec, err := m.devices.Get(r.Context(), authDeviceID)
	if err != nil || rec == nil {
		return errDeviceProofInvalid
	}
	if strings.TrimSpace(rec.RevokedAt) != "" {
		return errDeviceRevoked
	}
	if rec.SID != sid {
		return errDeviceProofInvalid
	}
	if uid, ok := r.Context().Value(ctxUserID).(string); ok && uid != "" && rec.UserID > 0 {
		if strconv.FormatInt(rec.UserID, 10) != strings.TrimSpace(uid) {
			return errDeviceProofInvalid
		}
	}
	_ = m.devices.Touch(r.Context(), authDeviceID, strings.TrimSpace(r.Header.Get("User-Agent")))
	return nil
}

func int64Claim(v any) int64 {
	switch n := v.(type) {
	case float64:
		return int64(n)
	case int64:
		return n
	case int:
		return int64(n)
	default:
		return 0
	}
}
