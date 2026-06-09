package httpapi

import (
	"net/http"
	"strings"

	"github.com/earflow/music-platform/security-service/internal/authz"
	"github.com/earflow/music-platform/security-service/internal/domain"
	"github.com/earflow/music-platform/security-service/internal/store"
)

type listSessionsResponse struct {
	Sessions []domain.SessionView `json:"sessions"`
}

func listSessionsHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, ok := authz.FromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
			return
		}
		sessions := d.collectDecoratedSessions(r, principal)
		writeJSON(w, http.StatusOK, listSessionsResponse{Sessions: sessions})
	}
}

type revokeOthersResponse struct {
	Revoked int `json:"revoked"`
}

type revokeSessionRequest struct {
	SID string `json:"sid"`
}

type revokeSessionResponse struct {
	Revoked bool `json:"revoked"`
}

func revokeSessionHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, ok := authz.FromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
			return
		}

		var req revokeSessionRequest
		if err := readJSON(r, 4096, &req); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_JSON", "Invalid JSON")
			return
		}
		targetSID := strings.TrimSpace(req.SID)
		if targetSID == "" {
			writeError(w, http.StatusBadRequest, "SID_REQUIRED", "sid required")
			return
		}
		if targetSID == principal.SID {
			writeError(w, http.StatusBadRequest, "CANNOT_REVOKE_CURRENT", "Use logout to end the current session")
			return
		}

		// Single-session revoke: MFA step-up when enabled; fresh-login guard applies only to mass revoke.
		if !d.requireStepUpForSensitiveSessionAction(w, r, principal, false) {
			return
		}

		if !d.sessionBelongsToUser(r, principal.UserID, targetSID) {
			writeError(w, http.StatusNotFound, "SESSION_NOT_FOUND", "Session not found")
			return
		}

		info, err := d.Redis.ReadSessionInfo(r.Context(), targetSID)
		if err != nil {
			d.Logger.Warn("sessions-revoke-one: read failed", "err", err, "sid", targetSID)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}
		jti := ""
		if info != nil {
			jti = info.JTI
		} else if pgRow := d.loadPGSessionOrNil(r, targetSID); pgRow != nil {
			jti = pgRow.RefreshJTI
		} else if !d.Redis.GatewaySessionExists(r.Context(), targetSID) {
			_ = d.Redis.RemoveUserSidFromIndex(r.Context(), principal.UserID, targetSID)
			writeJSON(w, http.StatusOK, revokeSessionResponse{Revoked: true})
			return
		}

		if err := store.RevokeSessionViaSoT(r.Context(), d.AuthSoT, d.Redis, principal.UserID, targetSID, jti, store.RevokeReasonOne); err != nil {
			d.Logger.Warn("sessions-revoke-one: revoke failed", "err", err, "sid", targetSID)
			writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service temporarily unavailable")
			return
		}
		writeJSON(w, http.StatusOK, revokeSessionResponse{Revoked: true})
	}
}

func revokeOtherSessionsHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, ok := authz.FromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
			return
		}

		if !d.requireStepUpForSensitiveSessionAction(w, r, principal, true) {
			return
		}

		revoked := d.revokeAllSessionsExcept(r, principal.UserID, principal.SID)
		writeJSON(w, http.StatusOK, revokeOthersResponse{Revoked: revoked})
	}
}

func revokeAllSessionsHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, ok := authz.FromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
			return
		}

		if !d.requireStepUpForSensitiveSessionAction(w, r, principal, true) {
			return
		}

		revoked := d.revokeAllSessionsIncludingCurrent(r, principal.UserID, principal.SID)
		writeJSON(w, http.StatusOK, revokeOthersResponse{Revoked: revoked})
	}
}
