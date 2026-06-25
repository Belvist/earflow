package auth

import (
	"context"
	"net/http"
	"os"
	"strconv"
	"strings"
)

const (
	headerAuthDeviceID    = "X-Auth-Device-Id"
	headerAuthDeviceProof = "X-Auth-Device-Proof"
	headerAuthDeviceTs    = "X-Auth-Device-Proof-Ts"
	headerAuthDeviceNonce = "X-Auth-Device-Proof-Nonce"
	envAllowCookieOnly    = "ALLOW_COOKIE_AUTH_WITHOUT_PROOF"
)

func deviceProofBypassPaths() map[string]struct{} {
	return map[string]struct{}{
		"/api/auth/email/login":     {},
		"/api/auth/email/register":  {},
		"/api/auth/telegram/login":  {},
		"/api/auth/csrf":            {},
		"/api/auth/device/register": {},
		"/api/auth/native/finalize": {},
		"/api/auth/native/exchange": {},
		"/api/public-config":        {},
		"/api/version":              {},
		"/health":                   {},
		"/metrics":                  {},
	}
}

// DeviceProofBypassPaths returns exact paths exempt from PoP (production enforcement).
// Route audit tests use this list; keep aligned with public/auth login surfaces.
func DeviceProofBypassPaths() map[string]struct{} {
	return deviceProofBypassPaths()
}

// DeviceProofRequiredForRequest reports whether PoP middleware would enforce proof.
func (m *SessionManager) DeviceProofRequiredForRequest(r *http.Request) bool {
	return m.deviceProofRequiredForRequest(r)
}

func (m *SessionManager) deviceProofEnforced() bool {
	if m != nil && m.isProduction {
		return true
	}
	return strings.TrimSpace(os.Getenv(envAllowCookieOnly)) != "1"
}

func (m *SessionManager) deviceProofRequiredForRequest(r *http.Request) bool {
	if !m.deviceProofEnforced() {
		return false
	}
	path := r.URL.Path
	if _, ok := deviceProofBypassPaths()[path]; ok {
		return false
	}
	if !strings.HasPrefix(path, "/api") {
		return false
	}
	if path == "/api/auth/refresh" || deviceProofSensitivePath(path) {
		if IsValidSID(m.pickSIDFromRequest(r)) {
			return true
		}
		authenticatedSID, _ := r.Context().Value(ctxSID).(string)
		return IsValidSID(authenticatedSID)
	}
	authenticatedSID, _ := r.Context().Value(ctxSID).(string)
	return IsValidSID(authenticatedSID)
}

func (m *SessionManager) proofSIDForRequest(r *http.Request) string {
	sid, _ := r.Context().Value(ctxSID).(string)
	if IsValidSID(sid) {
		return sid
	}
	return m.pickSIDFromRequest(r)
}

func (m *SessionManager) reserveProofNonce(ctx context.Context, authDeviceID, nonce string) error {
	if m == nil || m.rdb == nil {
		return errDeviceProofReplay
	}
	key := "auth:pop_nonce:" + strings.TrimSpace(authDeviceID) + ":" + strings.TrimSpace(nonce)
	ok, err := m.rdb.SetNX(ctx, key, "1", deviceProofNonceTTL).Result()
	if err != nil {
		return err
	}
	if !ok {
		return errDeviceProofReplay
	}
	return nil
}

func (m *SessionManager) validateDeviceProof(r *http.Request, sid string) error {
	authDeviceID := strings.TrimSpace(r.Header.Get(headerAuthDeviceID))
	proof := strings.TrimSpace(r.Header.Get(headerAuthDeviceProof))
	ts := strings.TrimSpace(r.Header.Get(headerAuthDeviceTs))
	nonce := strings.TrimSpace(r.Header.Get(headerAuthDeviceNonce))

	if authDeviceID == "" || proof == "" || ts == "" || nonce == "" {
		return errDeviceProofRequired
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

	if err := verifyDeviceProof(m.jwtSecret, rec.PublicKeySPKI, r.Method, r, ts, nonce, proof, sid); err != nil {
		return err
	}
	if err := m.reserveProofNonce(r.Context(), authDeviceID, nonce); err != nil {
		return err
	}
	_ = m.devices.Touch(r.Context(), authDeviceID, strings.TrimSpace(r.Header.Get("User-Agent")))
	return nil
}

func (m *SessionManager) DeviceProofMiddleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !m.deviceProofRequiredForRequest(r) {
				next.ServeHTTP(w, r)
				return
			}
			sid := m.proofSIDForRequest(r)
			if !IsValidSID(sid) {
				writeJSON(w, http.StatusUnauthorized, apiError{
					Error:          "Device proof required",
					Code:           authCodeDeviceProofReq,
					ReauthRequired: true,
				})
				return
			}

			path := r.URL.Path
			if proofAccessTokenEnabled() && !deviceProofSensitivePath(path) {
				if token := strings.TrimSpace(r.Header.Get(headerProofAccessToken)); token != "" {
					if err := m.validateProofAccessToken(r, sid); err != nil {
						code := deviceProofErrorCode(err)
						status := deviceProofHTTPStatus(code)
						reauth := code == authCodeDeviceProofReq || code == authCodeDeviceRevoked
						writeJSON(w, status, apiError{
							Error:          "Device proof required",
							Code:           code,
							ReauthRequired: reauth,
						})
						return
					}
					next.ServeHTTP(w, r)
					return
				}
			}

			if err := m.validateDeviceProof(r, sid); err != nil {
				code := deviceProofErrorCode(err)
				status := deviceProofHTTPStatus(code)
				reauth := code == authCodeDeviceProofReq || code == authCodeDeviceRevoked
				writeJSON(w, status, apiError{
					Error:          "Device proof required",
					Code:           code,
					ReauthRequired: reauth,
				})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
