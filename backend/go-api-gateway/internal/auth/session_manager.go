package auth

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/earflow/music-platform/go-api-gateway/internal/config"
	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"
)

type SessionManagerConfig struct {
	Redis                 *redis.Client
	JWTSecret             string
	JWTIssuer             string
	JWTAudience           string
	Cookie                config.CookieConfig
	CookieNames           config.CookieNamesConfig
	SessionTTL            time.Duration
	AuthBaseURL           string
	SecurityBaseURL       string
	ServiceKeyGateway     string
	TelegramBotUsername   string
	AllowedOrigins        []string
	IsProduction          bool
	ClientErrorLogEnabled bool
}

type SessionManager struct {
	store                 *SessionStore
	devices               *AuthDeviceStore
	rdb                   *redis.Client
	gatewaySessionPrefix  string
	jwtSecret             string
	jwtIssuer             string
	jwtAudience           string
	cookie                config.CookieConfig
	cookieNames           config.CookieNamesConfig
	sessionTTL            time.Duration
	authBaseURL           string
	telegramBotUsername   string
	allowedOrigins        map[string]struct{}
	isProduction          bool
	clientErrorLogEnabled bool
	hc                    http.Client
	sf                    singleflight.Group
	sot                   *SoTClient
	revokeSubStarted      atomic.Bool
	revokeMarks           *sync.Map
	proofEpochs           *proofEpochCache
}

func altCookieName(primary string) string {
	s := strings.TrimSpace(primary)
	switch s {
	case "mp_sid":
		return "mp_sid_artists"
	case "mp_sid_artists":
		return "mp_sid"
	case "mp_csrf":
		return "mp_csrf_artists"
	case "mp_csrf_artists":
		return "mp_csrf"
	default:
		return ""
	}
}

func (m *SessionManager) getSIDCandidates(r *http.Request) (string, string) {
	primaryName := strings.TrimSpace(m.cookieNames.SID)
	altName := altCookieName(primaryName)
	primary := GetCookie(r, primaryName)
	alt := ""
	if altName != "" {
		alt = GetCookie(r, altName)
	}
	if !IsValidSID(primary) {
		primary = ""
	}
	if !IsValidSID(alt) {
		alt = ""
	}
	return primary, alt
}

func (m *SessionManager) pickSIDFromRequest(r *http.Request) string {
	primary, alt := m.getSIDCandidates(r)
	if primary != "" {
		return primary
	}
	return alt
}

type ctxKey string

const (
	ctxUserID   ctxKey = "user_id"
	ctxUserRole ctxKey = "user_role"
	ctxUserJSON ctxKey = "user_json"
	ctxIsAdmin  ctxKey = "is_admin"
	ctxSID      ctxKey = "sid"
)

const csrfBlockedMessage = "CSRF blocked"

const authUnavailableMessage = "Auth unavailable"

const (
	authCodeAuthUnavailable   = "AUTH_UNAVAILABLE"
	authCodeCSRFBadOrigin     = "CSRF_BAD_ORIGIN"
	authCodeCSRFInvalid       = "CSRF_INVALID"
	authCodeCSRFMissing       = "CSRF_MISSING"
	authCodeCSRFMissingOrigin = "CSRF_MISSING_ORIGIN"
	authCodeNoSession         = "NO_SESSION"
	authCodeSessionUnverified = "SESSION_UNVERIFIED"
	authUnavailableCode       = authCodeAuthUnavailable
)

type refreshReq struct {
	RefreshToken string `json:"refreshToken"`
}

type refreshResp struct {
	AccessToken  string          `json:"accessToken"`
	RefreshToken string          `json:"refreshToken"`
	User         json.RawMessage `json:"user"`
}

type rotateStatus string

const (
	rotateStatusOK          rotateStatus = "ok"
	rotateStatusInvalid     rotateStatus = "invalid"
	rotateStatusUnavailable rotateStatus = "unavailable"
)

var (
	errRotateInvalid     = errors.New("refresh invalid")
	errRotateUnavailable = errors.New("auth unavailable")
)

type apiError struct {
	Error          string `json:"error"`
	Code           string `json:"code"`
	Recoverable    bool   `json:"recoverable,omitempty"`
	ReauthRequired bool   `json:"reauthRequired,omitempty"`
}

type userShape struct {
	ID             any    `json:"id"`
	UserID         any    `json:"userId"`
	Username       string `json:"username"`
	FirstName      string `json:"firstName"`
	FirstNameSnake string `json:"first_name"`
	IsAdmin        bool   `json:"isAdmin"`
	Role           string `json:"role"`
}

func extractUsername(claims jwt.MapClaims, userJSON json.RawMessage) string {
	if claims != nil {
		for _, k := range []string{"username", "name"} {
			if v, ok := claims[k]; ok {
				if s, ok := v.(string); ok {
					ss := strings.TrimSpace(s)
					if ss != "" {
						return ss
					}
				}
			}
		}
	}

	if len(userJSON) > 0 {
		var u userShape
		_ = json.Unmarshal(userJSON, &u)
		if s := strings.TrimSpace(u.Username); s != "" {
			return s
		}
		if s := strings.TrimSpace(u.FirstName); s != "" {
			return s
		}
		if s := strings.TrimSpace(u.FirstNameSnake); s != "" {
			return s
		}
	}
	return ""
}

func NewSessionManager(cfg SessionManagerConfig) (*SessionManager, error) {
	allowed := make(map[string]struct{}, len(cfg.AllowedOrigins))
	for _, o := range cfg.AllowedOrigins {
		allowed[o] = struct{}{}
	}
	base := strings.TrimRight(strings.TrimSpace(cfg.AuthBaseURL), "/")
	store, err := NewSessionStore(cfg.Redis, cfg.SessionTTL)
	if err != nil {
		return nil, err
	}

	return &SessionManager{
		store:                 store,
		devices:               NewAuthDeviceStore(cfg.Redis, cfg.SessionTTL),
		rdb:                   cfg.Redis,
		gatewaySessionPrefix:  store.keyPrefix,
		jwtSecret:             cfg.JWTSecret,
		jwtIssuer:             strings.TrimSpace(cfg.JWTIssuer),
		jwtAudience:           strings.TrimSpace(cfg.JWTAudience),
		cookie:                cfg.Cookie,
		cookieNames:           cfg.CookieNames,
		sessionTTL:            cfg.SessionTTL,
		authBaseURL:           base,
		telegramBotUsername:   strings.TrimSpace(cfg.TelegramBotUsername),
		allowedOrigins:        allowed,
		isProduction:          cfg.IsProduction,
		clientErrorLogEnabled: cfg.ClientErrorLogEnabled,
		hc:                    http.Client{Timeout: 12 * time.Second},
		sot: NewSoTClient(SoTClientConfig{
			SecurityBaseURL: cfg.SecurityBaseURL,
			ServiceKey:      cfg.ServiceKeyGateway,
			Mode:            parseSoTMode(),
		}),
		proofEpochs: newProofEpochCache(),
	}, nil
}

// RevokeSessionFull clears session state. dual_write: best-effort PG via security-service, then
// always local Redis (fail-safe if security/PG down — logout must not leave mp:sess alive).
// It also cleans auth-service session keys addressed by the refresh token's sid/jti claims.
func (m *SessionManager) RevokeSessionFull(ctx context.Context, sid string, userID int64, jti string) error {
	if m == nil {
		return nil
	}
	// Extract auth-service sid/jti claims BEFORE any downstream revoke deletes the
	// gateway session blob (security-service's dual-write revoke removes mp:sess).
	nodeSID, nodeJTI := m.nodeSessionClaims(ctx, sid)
	var sotErr error
	if m.sot != nil && m.sot.WritesEnabled() {
		sotErr = m.sot.RevokeSession(ctx, sid, userID, jti)
	}
	var redisErr error
	if m.rdb != nil {
		prefix := m.gatewaySessionPrefix
		if prefix == "" {
			prefix = GatewaySessionKeyPrefix()
		}
		redisErr = RevokeSessionFull(ctx, m.rdb, prefix, sid, userID, jti)
		if nodeSID != "" || nodeJTI != "" {
			_ = revokeNodeSession(ctx, m.rdb, userID, nodeSID, nodeJTI)
		}
	}
	if redisErr != nil {
		return redisErr
	}
	return sotErr
}

// nodeSessionClaims returns the auth-service session id and jti embedded in the
// gateway session's refresh token, if present. It must be called before the
// gateway session blob is deleted.
func (m *SessionManager) nodeSessionClaims(ctx context.Context, sid string) (string, string) {
	if m == nil || m.store == nil || !IsValidSID(sid) {
		return "", ""
	}
	sess, err := m.store.Get(ctx, sid)
	if err != nil || sess == nil {
		return "", ""
	}
	return extractSIDFromRefreshToken(sess.RefreshToken), extractJTIFromRefreshToken(sess.RefreshToken)
}

func (m *SessionManager) cookieMaxAgeSeconds() int {
	ttl := m.sessionTTL
	if ttl < 5*time.Minute {
		ttl = 5 * time.Minute
	}
	max := 365 * 24 * time.Hour
	if ttl > max {
		ttl = max
	}
	return int(ttl.Seconds())
}

func bypassesSessionAuthMiddleware(path string) bool {
	switch path {
	case "/api/auth/email/login", "/api/auth/email/register", "/api/auth/telegram/login",
		"/api/auth/reset-password", "/api/auth/csrf", "/api/auth/refresh",
		"/api/auth/logout", "/api/auth/native/exchange", "/api/public-config":
		return true
	default:
		return false
	}
}

func (m *SessionManager) SessionAuthMiddleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if m.deviceProofEnforced() && strings.HasPrefix(r.URL.Path, "/ws/") {
				next.ServeHTTP(w, r)
				return
			}

			primarySID, altSID := m.getSIDCandidates(r)
			if primarySID == "" && altSID == "" {
				next.ServeHTTP(w, r)
				return
			}
			if m.isSessionLocallyRevoked(primarySID) || m.isSessionLocallyRevoked(altSID) {
				if strings.HasPrefix(r.URL.Path, "/api") {
					writeJSON(w, http.StatusUnauthorized, apiError{Error: "Authentication required", Code: authCodeSessionUnverified})
					return
				}
				next.ServeHTTP(w, r)
				return
			}

			if bypassesSessionAuthMiddleware(r.URL.Path) {
				next.ServeHTTP(w, r)
				return
			}

			sid := primarySID
			sess, err := m.store.Get(r.Context(), sid)
			if err != nil {
				if strings.HasPrefix(r.URL.Path, "/api") {
					writeJSON(w, http.StatusServiceUnavailable, apiError{Error: authUnavailableMessage, Code: authUnavailableCode})
					return
				}
				next.ServeHTTP(w, r)
				return
			}
			if sess == nil && altSID != "" {
				sid = altSID
				sess, err = m.store.Get(r.Context(), sid)
				if err != nil {
					if strings.HasPrefix(r.URL.Path, "/api") {
						writeJSON(w, http.StatusServiceUnavailable, apiError{Error: authUnavailableMessage, Code: authUnavailableCode})
						return
					}
					next.ServeHTTP(w, r)
					return
				}
			}
			if sess == nil {
				next.ServeHTTP(w, r)
				return
			}

			_ = m.store.Touch(r.Context(), sid)

			accessOK, claims := m.verifyAccess(sess.AccessToken)
			if !accessOK {
				rotated, status := m.rotate(r, sid, sess.RefreshToken)
				switch status {
				case rotateStatusInvalid:
					recovered, recoveredClaims, recStatus := m.tryRecoverAfterRotateInvalid(r.Context(), sid)
					switch recStatus {
					case recoverAfterRotateInvalidOK:
						sess = recovered
						accessOK = true
						claims = recoveredClaims
					case recoverAfterRotateInvalidUnavailable:
						if strings.HasPrefix(r.URL.Path, "/api") {
							writeJSON(w, http.StatusServiceUnavailable, apiError{Error: authUnavailableMessage, Code: authUnavailableCode})
							return
						}
						next.ServeHTTP(w, r)
						return
					default:
						if strings.HasPrefix(r.URL.Path, "/api") {
							writeJSON(w, http.StatusUnauthorized, apiError{Error: "Authentication required", Code: authCodeSessionUnverified})
							return
						}
						next.ServeHTTP(w, r)
						return
					}
				case rotateStatusOK:
					accessOK2, claims2 := m.verifyAccess(rotated.AccessToken)
					if !accessOK2 {
						if strings.HasPrefix(r.URL.Path, "/api") {
							writeJSON(w, http.StatusServiceUnavailable, apiError{Error: authUnavailableMessage, Code: authUnavailableCode})
							return
						}
						next.ServeHTTP(w, r)
						return
					}
					accessOK = accessOK2
					claims = claims2

					sess.AccessToken = rotated.AccessToken
					sess.RefreshToken = rotated.RefreshToken
					nowRFC := time.Now().UTC().Format(time.RFC3339)
					sess.UpdatedAt = nowRFC
					sess.LastCookieRefreshAt = nowRFC
					if len(sess.User) == 0 && len(rotated.User) > 0 {
						sess.User = rotated.User
					}
					// L-3: do not swallow the Redis write error silently — after
					// rotation the upstream token is already burned, so a failed
					// local write is an observable incident, not noise.
					if err := m.store.Set(r.Context(), sid, *sess); err != nil {
						slog.Warn("auth session store write failed after refresh rotation", "err", err)
					}

					csrf, err := GenerateCSRFToken(sid, m.jwtSecret)
					if err == nil {
						SetSessionCookies(w, m.cookie, m.cookieNames, sid, csrf, m.cookieMaxAgeSeconds())
					}
				default:
					if strings.HasPrefix(r.URL.Path, "/api") {
						writeJSON(w, http.StatusServiceUnavailable, apiError{Error: authUnavailableMessage, Code: authUnavailableCode})
						return
					}
					next.ServeHTTP(w, r)
					return
				}

			}

			now := time.Now().UTC()
			last, err := time.Parse(time.RFC3339, strings.TrimSpace(sess.LastCookieRefreshAt))
			refreshCookies := err != nil || now.Sub(last) >= 24*time.Hour
			if refreshCookies {
				csrf, err := GenerateCSRFToken(sid, m.jwtSecret)
				if err == nil {
					SetSessionCookies(w, m.cookie, m.cookieNames, sid, csrf, m.cookieMaxAgeSeconds())
					nowRFC := now.Format(time.RFC3339)
					sess.LastCookieRefreshAt = nowRFC
					sess.UpdatedAt = nowRFC
					_ = m.store.Set(r.Context(), sid, *sess)
				}
			}

			r = r.WithContext(context.WithValue(r.Context(), ctxSID, sid))
			r.Header.Set("Authorization", "Bearer "+strings.TrimSpace(sess.AccessToken))

			uid := extractUserID(claims)
			role, isAdmin := extractRole(claims, sess.User)
			uname := extractUsername(claims, sess.User)
			if uid != "" {
				r.Header.Set("X-User-Id", uid)
				r.Header.Set("x-user-id", uid)
				r = r.WithContext(context.WithValue(r.Context(), ctxUserID, uid))
			}
			if uname != "" {
				r.Header.Set("X-User-Name", uname)
				r.Header.Set("x-user-name", uname)
			}
			if role != "" {
				r.Header.Set("X-User-Role", role)
				r = r.WithContext(context.WithValue(r.Context(), ctxUserRole, role))
			}
			r = r.WithContext(context.WithValue(r.Context(), ctxIsAdmin, isAdmin))
			r = r.WithContext(context.WithValue(r.Context(), ctxUserJSON, sess.User))

			next.ServeHTTP(w, r)
		})
	}
}

type recoverAfterRotateInvalidStatus string

const (
	recoverAfterRotateInvalidOK          recoverAfterRotateInvalidStatus = "ok"
	recoverAfterRotateInvalidNoSession   recoverAfterRotateInvalidStatus = "no_session"
	recoverAfterRotateInvalidNotValid    recoverAfterRotateInvalidStatus = "not_valid"
	recoverAfterRotateInvalidUnavailable recoverAfterRotateInvalidStatus = "unavailable"
)

func (m *SessionManager) tryRecoverAfterRotateInvalid(ctx context.Context, sid string) (*Session, jwt.MapClaims, recoverAfterRotateInvalidStatus) {
	var last recoverAfterRotateInvalidStatus
	for attempt := 0; attempt < 5; attempt++ {
		if attempt > 0 {
			timer := time.NewTimer(time.Duration(40*attempt) * time.Millisecond)
			select {
			case <-ctx.Done():
				timer.Stop()
				return nil, nil, recoverAfterRotateInvalidUnavailable
			case <-timer.C:
			}
		}

		sess, err := m.store.Get(ctx, sid)
		if err != nil {
			return nil, nil, recoverAfterRotateInvalidUnavailable
		}
		if sess == nil {
			last = recoverAfterRotateInvalidNoSession
			continue
		}
		ok, claims := m.verifyAccess(sess.AccessToken)
		if ok {
			return sess, claims, recoverAfterRotateInvalidOK
		}
		last = recoverAfterRotateInvalidNotValid
	}
	if last == "" {
		last = recoverAfterRotateInvalidNotValid
	}
	return nil, nil, last
}

func (m *SessionManager) CSRFEnsureCookieMiddleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet && r.Method != http.MethodHead {
				next.ServeHTTP(w, r)
				return
			}
			path := r.URL.Path
			if !strings.HasPrefix(path, "/api") {
				next.ServeHTTP(w, r)
				return
			}
			if path == "/health" || path == "/metrics" {
				next.ServeHTTP(w, r)
				return
			}

			sid := m.pickSIDFromRequest(r)
			if !IsValidSID(sid) {
				next.ServeHTTP(w, r)
				return
			}
			csrfName := strings.TrimSpace(m.cookieNames.CSRF)
			altCSRFName := altCookieName(csrfName)
			if GetCookie(r, csrfName) != "" || (altCSRFName != "" && GetCookie(r, altCSRFName) != "") {
				next.ServeHTTP(w, r)
				return
			}
			csrf, err := GenerateCSRFToken(sid, m.jwtSecret)
			if err == nil {
				setCookie(w, csrfName, csrf, false, m.cookie, m.cookieMaxAgeSeconds())
			}
			next.ServeHTTP(w, r)
		})
	}
}

// CSRFProtectionMiddleware enforces double-submit CSRF (Origin + cookie/header
// match + HMAC) on unsafe methods. Mounted on sensitive LOCAL auth POSTs
// (refresh/logout/proof-token/stream-ticket — see MountRoutes). Pre-session
// routes (login/register/telegram) must NOT pass through it: they have no
// session/csrf cookie yet and rely on EnforceOrigin only.
func (m *SessionManager) CSRFProtectionMiddleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if isSafeMethod(r.Method) {
				next.ServeHTTP(w, r)
				return
			}
			if !m.enforceCSRF(w, r) {
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func normalizeAPIError(payload any) any {
	err, ok := payload.(apiError)
	if !ok {
		return payload
	}
	switch err.Code {
	case authCodeAuthUnavailable, authCodeCSRFBadOrigin, authCodeCSRFInvalid, authCodeCSRFMissing, authCodeCSRFMissingOrigin, authCodeSessionUnverified:
		err.Recoverable = true
	case authCodeNoSession:
		err.ReauthRequired = true
	}
	return err
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	_ = enc.Encode(normalizeAPIError(payload))
}

func isSafeMethod(m string) bool {
	switch strings.ToUpper(m) {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	default:
		return false
	}
}

func (m *SessionManager) originAllowed(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return false
	}
	_, ok := m.allowedOrigins[origin]
	return ok
}

func (m *SessionManager) sameSiteFetch(r *http.Request) bool {
	v := strings.ToLower(strings.TrimSpace(r.Header.Get("Sec-Fetch-Site")))
	return v == "same-origin" || v == "same-site"
}

func (m *SessionManager) originOrRefererAllowed(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin != "" {
		_, ok := m.allowedOrigins[origin]
		return ok
	}
	if m.sameSiteFetch(r) {
		return true
	}
	ref := strings.TrimSpace(r.Header.Get("Referer"))
	if ref == "" {
		return false
	}
	u, err := url.Parse(ref)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return false
	}
	o := u.Scheme + "://" + u.Host
	_, ok := m.allowedOrigins[o]
	return ok
}

func (m *SessionManager) enforceOrigin(w http.ResponseWriter, r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		if m.originOrRefererAllowed(r) {
			return true
		}
		writeJSON(w, http.StatusForbidden, apiError{Error: csrfBlockedMessage, Code: "CSRF_MISSING_ORIGIN"})
		return false
	}
	if _, ok := m.allowedOrigins[origin]; !ok {
		writeJSON(w, http.StatusForbidden, apiError{Error: csrfBlockedMessage, Code: "CSRF_BAD_ORIGIN"})
		return false
	}
	return true
}

func (m *SessionManager) enforceCSRF(w http.ResponseWriter, r *http.Request) bool {
	primarySID, altSID := m.getSIDCandidates(r)
	if primarySID == "" && altSID == "" {
		writeJSON(w, http.StatusUnauthorized, apiError{Error: "Authentication required", Code: "NO_SESSION"})
		return false
	}
	if !m.enforceOrigin(w, r) {
		return false
	}
	csrfName := strings.TrimSpace(m.cookieNames.CSRF)
	altCSRFName := altCookieName(csrfName)

	csrfPrimary := GetCookie(r, csrfName)
	csrfAlt := ""
	if altCSRFName != "" {
		csrfAlt = GetCookie(r, altCSRFName)
	}
	csrfHeader := strings.TrimSpace(r.Header.Get("X-CSRF-Token"))

	if csrfHeader == "" || (csrfPrimary == "" && csrfAlt == "") {
		writeJSON(w, http.StatusForbidden, apiError{Error: csrfBlockedMessage, Code: "CSRF_MISSING"})
		return false
	}
	// L-17: constant-time compare for the double-submit cookie/header match.
	primaryMatch := csrfPrimary != "" && subtle.ConstantTimeCompare([]byte(csrfHeader), []byte(csrfPrimary)) == 1
	altMatch := csrfAlt != "" && subtle.ConstantTimeCompare([]byte(csrfHeader), []byte(csrfAlt)) == 1
	if !primaryMatch && !altMatch {
		writeJSON(w, http.StatusForbidden, apiError{Error: csrfBlockedMessage, Code: "CSRF_MISSING"})
		return false
	}
	if (primarySID != "" && VerifyCSRFToken(primarySID, m.jwtSecret, csrfHeader)) || (altSID != "" && VerifyCSRFToken(altSID, m.jwtSecret, csrfHeader)) {
		return true
	}
	if primarySID == "" {
		writeJSON(w, http.StatusUnauthorized, apiError{Error: "Authentication required", Code: "NO_SESSION"})
		return false
	}
	if !VerifyCSRFToken(primarySID, m.jwtSecret, csrfHeader) {
		writeJSON(w, http.StatusForbidden, apiError{Error: csrfBlockedMessage, Code: "CSRF_INVALID"})
		return false
	}
	return true
}

func (m *SessionManager) EnforceOrigin(w http.ResponseWriter, r *http.Request) bool {
	return m.enforceOrigin(w, r)
}

func (m *SessionManager) EnforceCSRF(w http.ResponseWriter, r *http.Request) bool {
	return m.enforceCSRF(w, r)
}

func (m *SessionManager) verifyAccess(token string) (bool, jwt.MapClaims) {
	clean := strings.TrimSpace(token)
	if clean == "" {
		return false, nil
	}
	// H-2: exp is REQUIRED. All live issuers set it (auth-core
	// RegisteredClaims.ExpiresAt, Node expiresIn); an access token without exp
	// must never validate even if signed.
	parser := jwt.NewParser(jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired())
	claims := jwt.MapClaims{}
	_, err := parser.ParseWithClaims(clean, claims, func(t *jwt.Token) (any, error) {
		return []byte(m.jwtSecret), nil
	})
	if err != nil {
		return false, nil
	}
	tp, typeOK := claims["type"]
	s, strOK := tp.(string)
	if !typeOK || !strOK || s != "access" {
		return false, nil
	}
	if !m.verifyIssuerAudience(claims) {
		return false, nil
	}
	return true, claims
}

func (m *SessionManager) verifyIssuerAudience(claims jwt.MapClaims) bool {
	if strings.TrimSpace(m.jwtIssuer) == "" && strings.TrimSpace(m.jwtAudience) == "" {
		return true
	}
	// L-20: issuer is enforced only when configured. Previously an empty issuer
	// with a non-empty audience forced every token to carry an empty `iss`,
	// rejecting legitimate issuer-tagged tokens.
	if strings.TrimSpace(m.jwtIssuer) != "" {
		iss, _ := claims["iss"].(string)
		if strings.TrimSpace(iss) != m.jwtIssuer {
			return false
		}
	}
	if strings.TrimSpace(m.jwtAudience) == "" {
		return true
	}
	aud := claims["aud"]
	switch v := aud.(type) {
	case string:
		return strings.TrimSpace(v) == m.jwtAudience
	case []any:
		for _, it := range v {
			if s, ok := it.(string); ok {
				if strings.TrimSpace(s) == m.jwtAudience {
					return true
				}
			}
		}
		return false
	case []string:
		for _, s := range v {
			if strings.TrimSpace(s) == m.jwtAudience {
				return true
			}
		}
		return false
	default:
		return false
	}
}

func (m *SessionManager) rotate(source *http.Request, sid string, refreshToken string) (refreshResp, rotateStatus) {
	key := "refresh:" + sid
	v, err, _ := m.sf.Do(key, func() (any, error) {
		rot, err := m.rotateOnce(source, refreshToken)
		if err != nil {
			return refreshResp{}, err
		}
		return rot, nil
	})
	if err != nil {
		if errors.Is(err, errRotateInvalid) {
			return refreshResp{}, rotateStatusInvalid
		}
		return refreshResp{}, rotateStatusUnavailable
	}
	rot, ok := v.(refreshResp)
	if !ok {
		return refreshResp{}, rotateStatusUnavailable
	}
	if strings.TrimSpace(rot.AccessToken) == "" || strings.TrimSpace(rot.RefreshToken) == "" {
		return refreshResp{}, rotateStatusUnavailable
	}
	return rot, rotateStatusOK
}

func (m *SessionManager) rotateOnce(source *http.Request, refreshToken string) (refreshResp, error) {
	if m.authBaseURL == "" {
		return refreshResp{}, errRotateUnavailable
	}
	payload, _ := json.Marshal(refreshReq{RefreshToken: refreshToken})
	u := m.authBaseURL + "/api/auth/refresh"
	req, err := http.NewRequestWithContext(source.Context(), http.MethodPost, u, bytes.NewReader(payload))
	if err != nil {
		return refreshResp{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	copyClientMetadataHeaders(req, source)
	resp, err := m.hc.Do(req)
	if err != nil {
		return refreshResp{}, errRotateUnavailable
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusBadRequest {
		return refreshResp{}, errRotateInvalid
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return refreshResp{}, errRotateUnavailable
	}
	var rr refreshResp
	if err := json.NewDecoder(resp.Body).Decode(&rr); err != nil {
		return refreshResp{}, err
	}
	return rr, nil
}

func extractUserID(claims jwt.MapClaims) string {
	if claims == nil {
		return ""
	}
	for _, k := range []string{"userId", "id", "sub"} {
		if v, ok := claims[k]; ok {
			return stringifyID(v)
		}
	}
	return ""
}

func extractRole(claims jwt.MapClaims, userJSON json.RawMessage) (string, bool) {
	isAdmin := false
	if claims != nil {
		if v, ok := claims["isAdmin"]; ok {
			if b, ok := v.(bool); ok {
				isAdmin = b
			}
		}
		if v, ok := claims["role"]; ok {
			if s, ok := v.(string); ok && s != "" {
				return s, isAdmin
			}
		}
	}

	if len(userJSON) > 0 {
		var u userShape
		_ = json.Unmarshal(userJSON, &u)
		if u.IsAdmin {
			isAdmin = true
		}
		if strings.TrimSpace(u.Role) != "" {
			return strings.TrimSpace(u.Role), isAdmin
		}
	}
	if isAdmin {
		return "admin", true
	}
	return "user", false
}

func stringifyID(v any) string {
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	case float64:
		return strings.TrimSpace(strings.TrimRight(strings.TrimRight(strconvFormatFloat(t), "0"), "."))
	default:
		return ""
	}
}

func strconvFormatFloat(v float64) string {
	b := make([]byte, 0, 32)
	b = strconvAppendFloat(b, v)
	return string(b)
}

func strconvAppendFloat(dst []byte, v float64) []byte {
	return strconv.AppendFloat(dst, v, 'f', -1, 64)
}
