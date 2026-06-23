package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

type deviceRegisterRequest struct {
	AuthDeviceID  string `json:"authDeviceId"`
	PublicKeySPKI string `json:"publicKeySpki"`
}

type deviceRegisterResponse struct {
	AuthDeviceID string `json:"authDeviceId"`
	SIDHash      string `json:"sidHash"`
	OK           bool   `json:"ok"`
}

func (m *SessionManager) handleDeviceRegister() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeMethodNotAllowedJSON(w)
			return
		}
		if !m.EnforceOrigin(w, r) {
			return
		}
		if !m.EnforceCSRF(w, r) {
			return
		}

		sid, _ := r.Context().Value(ctxSID).(string)
		if !IsValidSID(sid) {
			writeNoSessionJSON(w)
			return
		}
		uidStr, _ := r.Context().Value(ctxUserID).(string)
		userID := parseInt64ID(uidStr)
		if userID <= 0 {
			userID = userIDFromGatewaySessionFromRequest(r, m, sid)
		}
		if userID <= 0 {
			writeNoSessionJSON(w)
			return
		}

		body, err := readBodyCapped(w, r.Body, 16*1024)
		if err != nil {
			return
		}
		var req deviceRegisterRequest
		if err := json.Unmarshal(body, &req); err != nil {
			writeJSONResponse(w, http.StatusBadRequest, errorResponse{Error: "Invalid JSON"})
			return
		}
		authDeviceID := strings.TrimSpace(req.AuthDeviceID)
		pub := strings.TrimSpace(req.PublicKeySPKI)
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
		writeJSONResponse(w, http.StatusOK, deviceRegisterResponse{
			AuthDeviceID: authDeviceID,
			SIDHash:      sidHashForProof(m.jwtSecret, sid),
			OK:           true,
		})
	}
}

// revokeStaleSessionForAuthDevice ends the previous sid bound to the same authDeviceId
// (same browser / IndexedDB key) so re-login does not accumulate parallel sessions.
func (m *SessionManager) revokeStaleSessionForAuthDevice(ctx context.Context, authDeviceID, currentSID string, userID int64) {
	if m == nil || m.devices == nil {
		return
	}
	authDeviceID = strings.TrimSpace(authDeviceID)
	currentSID = strings.TrimSpace(currentSID)
	if authDeviceID == "" || currentSID == "" || userID <= 0 {
		return
	}
	existing, err := m.devices.Get(ctx, authDeviceID)
	if err != nil || existing == nil {
		return
	}
	oldSID := strings.TrimSpace(existing.SID)
	if oldSID == "" || oldSID == currentSID || existing.UserID != userID {
		return
	}
	_ = m.RevokeSessionFull(ctx, oldSID, userID, "")
}

func userIDFromGatewaySessionFromRequest(r *http.Request, m *SessionManager, sid string) int64 {
	if m == nil || m.store == nil {
		return 0
	}
	sess, err := m.store.Get(r.Context(), sid)
	if err != nil || sess == nil {
		return 0
	}
	return userIDFromGatewaySession(sess)
}
