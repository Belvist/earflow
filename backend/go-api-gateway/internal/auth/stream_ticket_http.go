package auth

import (
	"encoding/json"
	"net/http"
	"strings"
)

func (m *SessionManager) handleStreamTicket() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeMethodNotAllowedJSON(w)
			return
		}
		if !m.EnforceOrigin(w, r) {
			return
		}
		if !streamTicketEnabled() {
			writeJSON(w, http.StatusNotFound, apiError{Error: "Not found"})
			return
		}

		sid, _ := r.Context().Value(ctxSID).(string)
		if !IsValidSID(sid) {
			writeNoSessionJSON(w)
			return
		}
		userID, _ := r.Context().Value(ctxUserID).(string)
		authDeviceID := strings.TrimSpace(r.Header.Get(headerAuthDeviceID))
		if authDeviceID == "" {
			writeJSON(w, http.StatusUnauthorized, apiError{
				Error:          "Device proof required",
				Code:           authCodeDeviceProofReq,
				ReauthRequired: true,
			})
			return
		}

		body, err := readBodyCapped(w, r.Body, 4*1024)
		if err != nil {
			return
		}
		var req streamTicketMintRequest
		if len(body) == 0 {
			writeJSONResponse(w, http.StatusBadRequest, errorResponse{Error: "Invalid JSON"})
			return
		}
		if err := json.Unmarshal(body, &req); err != nil {
			writeJSONResponse(w, http.StatusBadRequest, errorResponse{Error: "Invalid JSON"})
			return
		}

		resp, err := m.mintStreamTicket(r.Context(), r, sid, userID, authDeviceID, req)
		if err != nil {
			switch err {
			case errDeviceProofRequired:
				writeJSON(w, http.StatusUnauthorized, apiError{
					Error:          "Device proof required",
					Code:           authCodeDeviceProofReq,
					ReauthRequired: true,
				})
			case errDeviceRevoked:
				writeJSON(w, http.StatusUnauthorized, apiError{
					Error:          "Device proof required",
					Code:           authCodeDeviceRevoked,
					ReauthRequired: true,
				})
			default:
				if strings.Contains(err.Error(), "scope") || strings.Contains(err.Error(), "kind") {
					writeJSONResponse(w, http.StatusBadRequest, errorResponse{Error: err.Error()})
					return
				}
				writeServiceUnavailableJSON(w, http.StatusServiceUnavailable)
			}
			return
		}
		logStreamTicketMint(req.Kind, resp.TicketType, resp.Transport, userID, resp.ExpiresIn)
		writeJSONResponse(w, http.StatusOK, resp)
	}
}
