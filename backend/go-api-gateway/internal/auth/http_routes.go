package auth

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

var clientErrorLogger = slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

type authTokenResponse struct {
	Token        string          `json:"token"`
	RefreshToken string          `json:"refreshToken"`
	User         json.RawMessage `json:"user"`
}

type errorResponse struct {
	Error          string `json:"error"`
	Code           string `json:"code,omitempty"`
	Recoverable    bool   `json:"recoverable,omitempty"`
	ReauthRequired bool   `json:"reauthRequired,omitempty"`
}

type publicConfigResponse struct {
	TelegramBotUsername string `json:"telegramBotUsername"`
}

const (
	hdrContentType = "Content-Type"
	hdrAccept      = "Accept"
	ctJSON         = "application/json"

	msgServiceUnavailable   = "Service temporarily unavailable"
	msgInvalidUpstream      = "Invalid upstream response"
	msgAuthenticationNeeded = "Authentication required"
)

func (m *SessionManager) MountRoutes(r chi.Router) {
	r.Get("/api/public-config", m.handlePublicConfig())
	r.Post("/api/auth/email/login", m.handleEmailLogin())
	r.Post("/api/auth/email/register", m.handleEmailRegister())
	r.Post("/api/auth/telegram/login", m.handleTelegramLogin())
	r.Get("/api/auth/csrf", m.handleCSRFCookie())
	r.Post("/api/auth/refresh", m.handleRefresh())
	r.Post("/api/auth/logout", m.handleLogout())
	r.Post("/api/auth/device/register", m.handleDeviceRegister())
	r.Get("/api/auth/native/finalize", m.handleNativeFinalize())
	r.Post("/api/auth/native/exchange", m.handleNativeExchange())
	r.Post("/api/auth/proof/token", m.handleProofToken())
	r.Post("/api/auth/stream-ticket", m.handleStreamTicket())
	r.Post("/api/log/error", m.handleClientErrorLog())
	r.Get("/api/profile", m.handleProfile())
	r.Get("/api/auth/profile", m.handleProfile())
}

func (m *SessionManager) handlePublicConfig() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeMethodNotAllowedJSON(w)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSONResponse(w, http.StatusOK, publicConfigResponse{TelegramBotUsername: strings.TrimSpace(m.telegramBotUsername)})
	}
}

func (m *SessionManager) handleCSRFCookie() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if !m.EnforceOrigin(w, r) {
			return
		}

		w.Header().Set("Cache-Control", "no-store")
		sid := m.pickSIDFromRequest(r)
		if !IsValidSID(sid) {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		csrf, err := GenerateCSRFToken(sid, m.jwtSecret)
		if err == nil {
			SetSessionCookies(w, m.cookie, m.cookieNames, sid, csrf, m.cookieMaxAgeSeconds())
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (m *SessionManager) handleEmailLogin() http.HandlerFunc {
	return m.handleAuthExchange("/api/auth/email/login")
}

func (m *SessionManager) handleEmailRegister() http.HandlerFunc {
	return m.handleAuthExchange("/api/auth/email/register")
}

func (m *SessionManager) handleTelegramLogin() http.HandlerFunc {
	return m.handleAuthExchange("/api/auth/telegram/login")
}

func (m *SessionManager) handleAuthExchange(upstreamPath string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeMethodNotAllowedJSON(w)
			return
		}
		if !m.EnforceOrigin(w, r) {
			return
		}
		if m.authBaseURL == "" {
			writeServiceUnavailableJSON(w, http.StatusServiceUnavailable)
			return
		}

		body, err := readBodyCapped(w, r.Body, 32*1024)
		if err != nil {
			return
		}
		if len(body) == 0 {
			writeJSONResponse(w, http.StatusBadRequest, errorResponse{Error: "Invalid JSON"})
			return
		}

		parsed, ok := m.fetchUpstreamAuthExchange(w, r, upstreamPath, body)
		if !ok {
			return
		}

		sid, err := newSID()
		if err != nil {
			writeServiceUnavailableJSON(w, http.StatusServiceUnavailable)
			return
		}

		now := time.Now().UTC().Format(time.RFC3339)
		sess := Session{AccessToken: parsed.Token, RefreshToken: parsed.RefreshToken, User: parsed.User, CreatedAt: now, UpdatedAt: now, LastCookieRefreshAt: now}
		if err := m.store.Set(r.Context(), sid, sess); err != nil {
			writeServiceUnavailableJSON(w, http.StatusServiceUnavailable)
			return
		}

		csrf, err := GenerateCSRFToken(sid, m.jwtSecret)
		if err != nil {
			_ = m.store.Delete(r.Context(), sid)
			writeServiceUnavailableJSON(w, http.StatusServiceUnavailable)
			return
		}
		SetSessionCookies(w, m.cookie, m.cookieNames, sid, csrf, m.cookieMaxAgeSeconds())
		if m.sot != nil && m.sot.WritesEnabled() {
			uid := userIDFromGatewaySession(&sess)
			jti := extractJTIFromRefreshToken(parsed.RefreshToken)
			m.sot.UpsertSession(r.Context(), sid, uid, jti, clientIPFromRequest(r), r.UserAgent())
		}
		writeJSONResponse(w, http.StatusOK, map[string]json.RawMessage{"user": parsed.User})
	}
}

func (m *SessionManager) handleRefresh() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeMethodNotAllowedJSON(w)
			return
		}
		if !m.EnforceOrigin(w, r) {
			return
		}
		sid := m.pickSIDFromRequest(r)
		if !IsValidSID(sid) {
			writeNoSessionJSON(w)
			return
		}

		sess, err := m.store.Get(r.Context(), sid)
		if err != nil {
			writeServiceUnavailableJSON(w, http.StatusServiceUnavailable)
			return
		}
		if sess == nil {
			writeNoSessionJSON(w)
			return
		}

		rotated, status := m.rotate(r, sid, sess.RefreshToken)
		if status == rotateStatusInvalid {
			recovered, _, recStatus := m.tryRecoverAfterRotateInvalid(r.Context(), sid)
			switch recStatus {
			case recoverAfterRotateInvalidOK:
				csrf, err := GenerateCSRFToken(sid, m.jwtSecret)
				if err == nil {
					SetSessionCookies(w, m.cookie, m.cookieNames, sid, csrf, m.cookieMaxAgeSeconds())
					now := time.Now().UTC().Format(time.RFC3339)
					recovered.LastCookieRefreshAt = now
					recovered.UpdatedAt = now
					_ = m.store.Set(r.Context(), sid, *recovered)
				}
				w.WriteHeader(http.StatusNoContent)
				return
			case recoverAfterRotateInvalidUnavailable:
				writeServiceUnavailableJSON(w, http.StatusServiceUnavailable)
				return
			case recoverAfterRotateInvalidNoSession:
				writeNoSessionJSON(w)
				return
			default:
				writeSessionUnverifiedJSON(w)
				return
			}
		}
		if status != rotateStatusOK {
			writeServiceUnavailableJSON(w, http.StatusServiceUnavailable)
			return
		}

		sess.AccessToken = rotated.AccessToken
		sess.RefreshToken = rotated.RefreshToken
		sess.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		if len(sess.User) == 0 && len(rotated.User) > 0 {
			sess.User = rotated.User
		}
		if err := m.store.Set(r.Context(), sid, *sess); err != nil {
			writeServiceUnavailableJSON(w, http.StatusServiceUnavailable)
			return
		}

		csrf, err := GenerateCSRFToken(sid, m.jwtSecret)
		if err == nil {
			SetSessionCookies(w, m.cookie, m.cookieNames, sid, csrf, m.cookieMaxAgeSeconds())
			now := time.Now().UTC().Format(time.RFC3339)
			sess.LastCookieRefreshAt = now
			sess.UpdatedAt = now
			_ = m.store.Set(r.Context(), sid, *sess)
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (m *SessionManager) handleLogout() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if !m.EnforceOrigin(w, r) {
			return
		}
		sid := m.pickSIDFromRequest(r)
		if IsValidSID(sid) {
			var userID int64
			var jti string
			if sess, err := m.store.Get(r.Context(), sid); err == nil && sess != nil {
				userID = userIDFromGatewaySession(sess)
			}
			if m.rdb != nil {
				if got, err := m.rdb.Get(r.Context(), authSIDKey(sid)).Result(); err == nil {
					jti = strings.TrimSpace(got)
				}
			}
			_ = m.RevokeSessionFull(r.Context(), sid, userID, jti)
		}
		ClearSessionCookies(w, m.cookie, m.cookieNames)
		w.WriteHeader(http.StatusNoContent)
	}
}

func (m *SessionManager) handleProfile() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		primarySID, altSID := m.getSIDCandidates(r)
		authenticatedSID, _ := r.Context().Value(ctxSID).(string)
		if !IsValidSID(authenticatedSID) || (authenticatedSID != primarySID && authenticatedSID != altSID) {
			writeNoSessionJSON(w)
			return
		}
		sess, err := m.store.Get(r.Context(), authenticatedSID)
		if err != nil {
			writeServiceUnavailableJSON(w, http.StatusServiceUnavailable)
			return
		}
		if sess == nil {
			writeNoSessionJSON(w)
			return
		}
		if len(sess.User) == 0 {
			writeNoSessionJSON(w)
			return
		}
		writeJSONResponse(w, http.StatusOK, json.RawMessage(sess.User))
	}
}

type clientErrorLogRequest struct {
	Code           string `json:"code"`
	TrackID        string `json:"trackId"`
	PlaybackEngine string `json:"playbackEngine"`
	EffectiveType  string `json:"effectiveType"`
	AtMs           int64  `json:"atMs"`
	UserAgent      string `json:"userAgent"`
}

func (m *SessionManager) handleClientErrorLog() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin != "" {
			if _, ok := m.allowedOrigins[origin]; !ok {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		} else {
			if !m.originOrRefererAllowed(r) {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		body, err := readBodyCapped(w, r.Body, 8*1024)
		if err != nil {
			return
		}
		if len(body) == 0 {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		var req clientErrorLogRequest
		if err := json.Unmarshal(body, &req); err != nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		code := strings.TrimSpace(req.Code)
		if code == "" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.WriteHeader(http.StatusNoContent)

		if !m.clientErrorLogEnabled {
			return
		}

		cid := strings.TrimSpace(r.Header.Get("X-Correlation-Id"))
		uid := strings.TrimSpace(r.Header.Get("X-User-Id"))

		trackID := strings.TrimSpace(req.TrackID)
		if len(trackID) > 64 {
			trackID = trackID[:64]
		}
		engine := strings.TrimSpace(req.PlaybackEngine)
		if len(engine) > 16 {
			engine = engine[:16]
		}
		eff := strings.TrimSpace(req.EffectiveType)
		if len(eff) > 16 {
			eff = eff[:16]
		}
		ua := strings.TrimSpace(req.UserAgent)
		if len(ua) > 220 {
			ua = ua[:220]
		}
		atMs := req.AtMs
		if atMs <= 0 {
			atMs = time.Now().UnixMilli()
		}
		if len(code) > 80 {
			code = code[:80]
		}

		clientErrorLogger.Info("client_error",
			slog.String("code", code),
			slog.String("trackId", trackID),
			slog.String("playbackEngine", engine),
			slog.String("effectiveType", eff),
			slog.Int64("atMs", atMs),
			slog.String("userAgent", ua),
			slog.String("origin", origin),
			slog.String("correlationId", cid),
			slog.String("userId", uid),
		)
	}
}

func newSID() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func readBodyCapped(w http.ResponseWriter, body io.Reader, maxBytes int64) ([]byte, error) {
	if maxBytes <= 0 {
		writeJSONResponse(w, http.StatusBadRequest, errorResponse{Error: "Invalid request"})
		return nil, errors.New("invalid maxBytes")
	}
	lr := io.LimitReader(body, maxBytes+1)
	b, err := io.ReadAll(lr)
	if err != nil {
		writeJSONResponse(w, http.StatusBadRequest, errorResponse{Error: "Invalid request"})
		return nil, err
	}
	if int64(len(b)) > maxBytes {
		writeJSONResponse(w, http.StatusRequestEntityTooLarge, errorResponse{Error: "Request too large"})
		return nil, errors.New("request too large")
	}
	return b, nil
}

func normalizeErrorResponsePayload(raw any) any {
	err, ok := raw.(errorResponse)
	if !ok {
		return raw
	}
	switch err.Code {
	case authCodeAuthUnavailable, authCodeCSRFBadOrigin, authCodeCSRFInvalid, authCodeCSRFMissing, authCodeCSRFMissingOrigin, authCodeSessionUnverified:
		err.Recoverable = true
	case authCodeNoSession:
		err.ReauthRequired = true
	}
	return err
}

func writeJSONResponse(w http.ResponseWriter, status int, raw any) {
	w.Header().Set(hdrContentType, ctJSON)
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(normalizeErrorResponsePayload(raw))
}

func clientIPFromRequest(r *http.Request) string {
	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
		if i := strings.Index(xff, ","); i > 0 {
			return strings.TrimSpace(xff[:i])
		}
		return xff
	}
	host := strings.TrimSpace(r.RemoteAddr)
	if i := strings.LastIndex(host, ":"); i > 0 {
		return host[:i]
	}
	return host
}

func copyUpstreamError(w http.ResponseWriter, resp *http.Response) {
	st := resp.StatusCode
	if st < 400 {
		st = http.StatusBadGateway
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8*1024))
	ct := strings.ToLower(strings.TrimSpace(resp.Header.Get(hdrContentType)))
	if strings.Contains(ct, ctJSON) && len(body) > 0 {
		writeJSONResponse(w, st, json.RawMessage(body))
		return
	}
	writeJSONResponse(w, st, errorResponse{Error: "Authentication failed"})
}

func writeMethodNotAllowedJSON(w http.ResponseWriter) {
	writeJSONResponse(w, http.StatusMethodNotAllowed, errorResponse{Error: "Method not allowed"})
}

func writeServiceUnavailableJSON(w http.ResponseWriter, status int) {
	writeJSONResponse(w, status, errorResponse{Error: msgServiceUnavailable, Code: authCodeAuthUnavailable})
}

func writeInvalidUpstreamJSON(w http.ResponseWriter) {
	writeJSONResponse(w, http.StatusBadGateway, errorResponse{Error: msgInvalidUpstream})
}

func writeNoSessionJSON(w http.ResponseWriter) {
	writeJSONResponse(w, http.StatusUnauthorized, errorResponse{Error: msgAuthenticationNeeded, Code: authCodeNoSession})
}

func writeSessionUnverifiedJSON(w http.ResponseWriter) {
	writeJSONResponse(w, http.StatusUnauthorized, errorResponse{Error: msgAuthenticationNeeded, Code: authCodeSessionUnverified})
}

func copyClientMetadataHeaders(dst *http.Request, src *http.Request) {
	if dst == nil || src == nil {
		return
	}

	if ua := strings.TrimSpace(src.UserAgent()); ua != "" {
		dst.Header.Set("User-Agent", ua)
	}

	xff := strings.TrimSpace(src.Header.Get("X-Forwarded-For"))
	if xff == "" {
		xff = remoteIPOnly(src.RemoteAddr)
	}
	if xff != "" {
		dst.Header.Set("X-Forwarded-For", xff)
	}

	xri := strings.TrimSpace(src.Header.Get("X-Real-IP"))
	if xri == "" {
		xri = firstForwardedIP(xff)
	}
	if xri != "" {
		dst.Header.Set("X-Real-IP", xri)
	}

	proto := strings.TrimSpace(src.Header.Get("X-Forwarded-Proto"))
	if proto == "" {
		if src.TLS != nil {
			proto = "https"
		} else {
			proto = "http"
		}
	}
	dst.Header.Set("X-Forwarded-Proto", proto)

	host := strings.TrimSpace(src.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = strings.TrimSpace(src.Host)
	}
	if host != "" {
		dst.Header.Set("X-Forwarded-Host", host)
	}
}

func remoteIPOnly(remoteAddr string) string {
	remoteAddr = strings.TrimSpace(remoteAddr)
	if remoteAddr == "" {
		return ""
	}
	if host, _, err := net.SplitHostPort(remoteAddr); err == nil {
		return strings.TrimSpace(host)
	}
	return remoteAddr
}

func firstForwardedIP(xff string) string {
	xff = strings.TrimSpace(xff)
	if xff == "" {
		return ""
	}
	parts := strings.Split(xff, ",")
	if len(parts) == 0 {
		return ""
	}
	return strings.TrimSpace(parts[0])
}

func (m *SessionManager) fetchUpstreamAuthExchange(w http.ResponseWriter, source *http.Request, upstreamPath string, body []byte) (authTokenResponse, bool) {
	req, err := http.NewRequestWithContext(source.Context(), http.MethodPost, m.authBaseURL+upstreamPath, bytes.NewReader(body))
	if err != nil {
		writeServiceUnavailableJSON(w, http.StatusServiceUnavailable)
		return authTokenResponse{}, false
	}
	req.Header.Set(hdrContentType, ctJSON)
	req.Header.Set(hdrAccept, ctJSON)
	copyClientMetadataHeaders(req, source)

	resp, err := m.hc.Do(req)
	if err != nil {
		writeServiceUnavailableJSON(w, http.StatusBadGateway)
		return authTokenResponse{}, false
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		copyUpstreamError(w, resp)
		return authTokenResponse{}, false
	}

	raw, err := readBodyCapped(w, resp.Body, 128*1024)
	if err != nil {
		return authTokenResponse{}, false
	}

	var parsed authTokenResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		writeInvalidUpstreamJSON(w)
		return authTokenResponse{}, false
	}
	if strings.TrimSpace(parsed.Token) == "" || strings.TrimSpace(parsed.RefreshToken) == "" || len(parsed.User) == 0 {
		writeInvalidUpstreamJSON(w)
		return authTokenResponse{}, false
	}
	return parsed, true
}
