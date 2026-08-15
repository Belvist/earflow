package auth

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// Native app login (OAuth 2.0 Authorization Code + PKCE, S256).
//
// Flow (Spotify-style, reuses existing web login + PoP):
//  1. iOS opens ASWebAuthenticationSession at auth.earflow.ru/login with
//     return_to = https://api.earflow.ru/api/auth/native/finalize?redirect_uri=earflow://...&state=...&code_challenge=...
//  2. User authenticates on the site (email / Telegram / MFA) — full web parity.
//  3. The web login redirects (return_to) to /api/auth/native/finalize, which runs WITH the
//     freshly-set session cookie, mints a one-time code bound to {sid, code_challenge}, and
//     302-redirects to the custom scheme: earflow://auth/callback?code=...&state=...
//  4. ASWebAuthenticationSession captures the callback and hands the code to the app.
//  5. App calls POST /api/auth/native/exchange {code, codeVerifier, authDeviceId, publicKeySpki}.
//     Gateway verifies PKCE, consumes the code (one-time), binds the device key to the session
//     (same as device register), and sets the session cookies for the app's URLSession jar.
//
// Security model:
//   - The one-time code is 256-bit random, single-use (GETDEL), 60s TTL.
//   - PKCE S256 binds the code to the app instance that started the flow: a code intercepted via a
//     hijacked custom URL scheme is useless without the matching code_verifier.
//   - redirect_uri is matched against a strict allowlist — no open redirect / code exfiltration.
//   - finalize requires a valid session (SessionAuthMiddleware) and never returns user data, only a code.
//   - exchange is unauthenticated by cookie (bootstrap) but gated by PKCE + one-time code + Origin.
const (
	nativeAuthCodeTTL         = 60 * time.Second
	nativeAuthCodeRedisPrefix = "auth:native_code:"
	envNativeAuthRedirectURIs = "NATIVE_AUTH_REDIRECT_URIS"
	defaultNativeRedirectURI  = "earflow://auth/callback"
	minPKCEVerifierLen        = 43
	maxPKCEVerifierLen        = 128
	maxCodeChallengeLen       = 128
)

type nativeCodePayload struct {
	SID           string `json:"sid"`
	UserID        int64  `json:"userId"`
	CodeChallenge string `json:"codeChallenge"`
	CreatedAt     int64  `json:"createdAt"`
}

type nativeExchangeRequest struct {
	Code          string `json:"code"`
	CodeVerifier  string `json:"codeVerifier"`
	AuthDeviceID  string `json:"authDeviceId"`
	PublicKeySPKI string `json:"publicKeySpki"`
}

type nativeExchangeResponse struct {
	User         json.RawMessage `json:"user"`
	AuthDeviceID string          `json:"authDeviceId"`
	SIDHash      string          `json:"sidHash"`
	OK           bool            `json:"ok"`
}

func nativeAuthAllowedRedirectURIs() []string {
	raw := strings.TrimSpace(os.Getenv(envNativeAuthRedirectURIs))
	if raw == "" {
		return []string{defaultNativeRedirectURI}
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return []string{defaultNativeRedirectURI}
	}
	return out
}

func nativeAuthRedirectAllowed(uri string) bool {
	uri = strings.TrimSpace(uri)
	if uri == "" {
		return false
	}
	for _, allowed := range nativeAuthAllowedRedirectURIs() {
		if subtle.ConstantTimeCompare([]byte(uri), []byte(allowed)) == 1 {
			return true
		}
	}
	return false
}

func isValidCodeChallenge(c string) bool {
	c = strings.TrimSpace(c)
	if len(c) < minPKCEVerifierLen || len(c) > maxCodeChallengeLen {
		return false
	}
	return isBase64URLNoPad(c)
}

func isValidPKCEVerifier(v string) bool {
	v = strings.TrimSpace(v)
	if len(v) < minPKCEVerifierLen || len(v) > maxPKCEVerifierLen {
		return false
	}
	// RFC 7636 unreserved verifier alphabet: ALPHA / DIGIT / "-" / "." / "_" / "~".
	for _, r := range v {
		switch {
		case r >= 'A' && r <= 'Z', r >= 'a' && r <= 'z', r >= '0' && r <= '9':
		case r == '-' || r == '.' || r == '_' || r == '~':
		default:
			return false
		}
	}
	return true
}

func isBase64URLNoPad(s string) bool {
	for _, r := range s {
		switch {
		case r >= 'A' && r <= 'Z', r >= 'a' && r <= 'z', r >= '0' && r <= '9':
		case r == '-' || r == '_':
		default:
			return false
		}
	}
	return true
}

// verifyPKCES256 reports whether base64url(SHA256(verifier)) == challenge in constant time.
func verifyPKCES256(verifier, challenge string) bool {
	if !isValidPKCEVerifier(verifier) || !isValidCodeChallenge(challenge) {
		return false
	}
	sum := sha256.Sum256([]byte(strings.TrimSpace(verifier)))
	computed := base64.RawURLEncoding.EncodeToString(sum[:])
	return subtle.ConstantTimeCompare([]byte(computed), []byte(strings.TrimSpace(challenge))) == 1
}

func buildNativeRedirect(redirectURI string, params map[string]string) string {
	u, err := url.Parse(redirectURI)
	if err != nil {
		return redirectURI
	}
	q := u.Query()
	for k, v := range params {
		if strings.TrimSpace(v) != "" {
			q.Set(k, v)
		}
	}
	u.RawQuery = q.Encode()
	return u.String()
}

func redirectNativeError(w http.ResponseWriter, r *http.Request, redirectURI, state, errCode string) {
	target := buildNativeRedirect(redirectURI, map[string]string{"error": errCode, "state": state})
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, target, http.StatusFound)
}

// handleNativeFinalize mints a one-time PKCE-bound code and redirects to the native callback.
// Reached via the web login's return_to with the freshly-set session cookie.
func (m *SessionManager) handleNativeFinalize() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeMethodNotAllowedJSON(w)
			return
		}
		// L-18: finalize mints a PKCE code bound to the current session cookie.
		// Cross-site top-level GETs from an attacker origin (luring the victim
		// into completing a code exchange for the attacker's challenge) must not
		// mint codes. Same-origin navigations (login return_to flow) keep
		// working: enforceOrigin accepts same-site fetches / allowed Referer
		// when the browser omits Origin on the redirect.
		if !m.EnforceOrigin(w, r) {
			return
		}
		q := r.URL.Query()
		redirectURI := strings.TrimSpace(q.Get("redirect_uri"))
		state := strings.TrimSpace(q.Get("state"))
		challenge := strings.TrimSpace(q.Get("code_challenge"))
		method := strings.TrimSpace(q.Get("code_challenge_method"))

		// redirect_uri allowlist is the only anti-open-redirect guard — never redirect to an
		// untrusted target, render a plain error instead.
		if !nativeAuthRedirectAllowed(redirectURI) {
			writeJSONResponse(w, http.StatusBadRequest, errorResponse{Error: "invalid redirect_uri"})
			return
		}
		if method == "" {
			method = "S256"
		}
		if !strings.EqualFold(method, "S256") {
			redirectNativeError(w, r, redirectURI, state, "unsupported_challenge_method")
			return
		}
		if !isValidCodeChallenge(challenge) {
			redirectNativeError(w, r, redirectURI, state, "invalid_code_challenge")
			return
		}

		sid, _ := r.Context().Value(ctxSID).(string)
		if !IsValidSID(sid) {
			// No session (login not completed / cancelled) — tell the app to retry.
			redirectNativeError(w, r, redirectURI, state, "login_required")
			return
		}
		uidStr, _ := r.Context().Value(ctxUserID).(string)
		userID := parseInt64ID(uidStr)
		if userID <= 0 {
			userID = userIDFromGatewaySessionFromRequest(r, m, sid)
		}
		if userID <= 0 {
			redirectNativeError(w, r, redirectURI, state, "login_required")
			return
		}

		if m.rdb == nil {
			redirectNativeError(w, r, redirectURI, state, "server_unavailable")
			return
		}

		code, err := newSID()
		if err != nil {
			redirectNativeError(w, r, redirectURI, state, "server_error")
			return
		}
		payload, err := json.Marshal(nativeCodePayload{
			SID:           sid,
			UserID:        userID,
			CodeChallenge: challenge,
			CreatedAt:     time.Now().Unix(),
		})
		if err != nil {
			redirectNativeError(w, r, redirectURI, state, "server_error")
			return
		}
		ok, err := m.rdb.SetNX(r.Context(), nativeAuthCodeRedisPrefix+code, payload, nativeAuthCodeTTL).Result()
		if err != nil || !ok {
			redirectNativeError(w, r, redirectURI, state, "server_error")
			return
		}

		target := buildNativeRedirect(redirectURI, map[string]string{"code": code, "state": state})
		w.Header().Set("Cache-Control", "no-store")
		http.Redirect(w, r, target, http.StatusFound)
	}
}

// handleNativeExchange consumes a one-time code, verifies PKCE, binds the device key to the
// session, and issues session cookies to the native app.
func (m *SessionManager) handleNativeExchange() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeMethodNotAllowedJSON(w)
			return
		}
		if !m.EnforceOrigin(w, r) {
			return
		}
		if m.rdb == nil {
			writeServiceUnavailableJSON(w, http.StatusServiceUnavailable)
			return
		}

		body, err := readBodyCapped(w, r.Body, 16*1024)
		if err != nil {
			return
		}
		var req nativeExchangeRequest
		if err := json.Unmarshal(body, &req); err != nil {
			writeJSONResponse(w, http.StatusBadRequest, errorResponse{Error: "Invalid JSON"})
			return
		}
		code := strings.TrimSpace(req.Code)
		verifier := strings.TrimSpace(req.CodeVerifier)
		authDeviceID := strings.TrimSpace(req.AuthDeviceID)
		pub := strings.TrimSpace(req.PublicKeySPKI)

		if code == "" || verifier == "" {
			writeJSONResponse(w, http.StatusBadRequest, errorResponse{Error: "code and codeVerifier required"})
			return
		}
		if !isValidPKCEVerifier(verifier) {
			writeJSONResponse(w, http.StatusBadRequest, errorResponse{Error: "Invalid codeVerifier"})
			return
		}
		if !IsValidSID(authDeviceID) {
			writeJSONResponse(w, http.StatusBadRequest, errorResponse{Error: "Invalid authDeviceId"})
			return
		}
		if pub == "" {
			writeJSONResponse(w, http.StatusBadRequest, errorResponse{Error: "publicKeySpki required"})
			return
		}
		if _, err := parseECDSAPublicKeySPKI(pub); err != nil {
			writeJSONResponse(w, http.StatusBadRequest, errorResponse{Error: "Invalid publicKeySpki"})
			return
		}

		// Single-use consume — even an invalid PKCE attempt burns the code.
		raw, err := m.rdb.GetDel(r.Context(), nativeAuthCodeRedisPrefix+code).Result()
		if err != nil || strings.TrimSpace(raw) == "" {
			writeJSONResponse(w, http.StatusUnauthorized, errorResponse{Error: "Invalid or expired code", Code: authCodeNoSession})
			return
		}
		var payload nativeCodePayload
		if err := json.Unmarshal([]byte(raw), &payload); err != nil {
			writeJSONResponse(w, http.StatusUnauthorized, errorResponse{Error: "Invalid code"})
			return
		}
		if !verifyPKCES256(verifier, payload.CodeChallenge) {
			writeJSONResponse(w, http.StatusUnauthorized, errorResponse{Error: "PKCE verification failed"})
			return
		}

		sid := strings.TrimSpace(payload.SID)
		if !IsValidSID(sid) {
			writeNoSessionJSON(w)
			return
		}
		sess, err := m.store.Get(r.Context(), sid)
		if err != nil {
			writeServiceUnavailableJSON(w, http.StatusServiceUnavailable)
			return
		}
		if sess == nil || len(sess.User) == 0 {
			writeNoSessionJSON(w)
			return
		}
		userID := payload.UserID
		if userID <= 0 {
			userID = userIDFromGatewaySession(sess)
		}
		if userID <= 0 {
			writeNoSessionJSON(w)
			return
		}

		// Bind the device key to the session (identical contract to /api/auth/device/register).
		m.revokeStaleSessionForAuthDevice(r.Context(), authDeviceID, sid, userID)
		now := time.Now().UTC().Format(time.RFC3339)
		rec := AuthDeviceRecord{
			AuthDeviceID:  authDeviceID,
			SID:           sid,
			UserID:        userID,
			PublicKeySPKI: pub,
			CreatedAt:     now,
			LastSeenAt:    now,
			UA:            strings.TrimSpace(r.Header.Get("User-Agent")),
		}
		if err := m.devices.Save(r.Context(), rec); err != nil {
			writeServiceUnavailableJSON(w, http.StatusServiceUnavailable)
			return
		}
		if m.sot != nil && m.sot.WritesEnabled() {
			m.sot.UpsertDevice(r.Context(), authDeviceID, sid, userID, pub, r.UserAgent())
		}

		csrf, err := GenerateCSRFToken(sid, m.jwtSecret)
		if err != nil {
			writeServiceUnavailableJSON(w, http.StatusServiceUnavailable)
			return
		}
		SetSessionCookies(w, m.cookie, m.cookieNames, sid, csrf, m.cookieMaxAgeSeconds())
		writeJSONResponse(w, http.StatusOK, nativeExchangeResponse{
			User:         sess.User,
			AuthDeviceID: authDeviceID,
			SIDHash:      sidHashForProof(m.jwtSecret, sid),
			OK:           true,
		})
	}
}
