package auth

import (
	"net/http"
	"strings"
	"time"
)

func (m *SessionManager) handleProofToken() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeMethodNotAllowedJSON(w)
			return
		}
		if !m.EnforceOrigin(w, r) {
			return
		}
		if !proofAccessTokenEnabled() {
			writeJSON(w, http.StatusNotFound, apiError{Error: "Not found"})
			return
		}

		sid, _ := r.Context().Value(ctxSID).(string)
		if !IsValidSID(sid) {
			writeNoSessionJSON(w)
			return
		}
		// Full ECDSA + nonce already enforced by DeviceProofMiddleware (sensitive path).

		authDeviceID := strings.TrimSpace(r.Header.Get(headerAuthDeviceID))
		epochs, err := m.lookupProofEpochs(r.Context(), sid, authDeviceID)
		if err != nil {
			// PG lookup optional for dev — issue with zero epochs; revoke pub/sub still invalidates.
			epochs = ProofEpochLookup{}
		}
		if epochs.SessionRevoked || epochs.DeviceRevoked {
			writeJSON(w, http.StatusUnauthorized, apiError{
				Error:          "Device proof required",
				Code:           authCodeDeviceRevoked,
				ReauthRequired: true,
			})
			return
		}

		token, exp, err := m.issueProofAccessToken(sid, authDeviceID, epochs)
		if err != nil {
			writeServiceUnavailableJSON(w, http.StatusServiceUnavailable)
			return
		}
		writeJSONResponse(w, http.StatusOK, proofAccessTokenResponse{
			Token:     token,
			ExpiresIn: int64(time.Until(exp).Seconds()),
			ExpiresAt: exp.UTC().Format(time.RFC3339),
		})
	}
}
