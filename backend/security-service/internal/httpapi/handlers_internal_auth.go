package httpapi

import (
	"net/http"
	"strings"

	"github.com/earflow/music-platform/security-service/internal/store"
	"github.com/earflow/music-platform/security-service/internal/store/authpg"
)

type internalSessionUpsertRequest struct {
	SID        string `json:"sid"`
	UserID     int64  `json:"userId"`
	RefreshJTI string `json:"refreshJti"`
	IP         string `json:"ip"`
	UserAgent  string `json:"userAgent"`
}

type internalDeviceUpsertRequest struct {
	AuthDeviceID  string `json:"authDeviceId"`
	SID           string `json:"sid"`
	UserID        int64  `json:"userId"`
	PublicKeySPKI string `json:"publicKeySpki"`
	UserAgent     string `json:"userAgent"`
}

type internalSessionRevokeRequest struct {
	SID    string `json:"sid"`
	UserID int64  `json:"userId"`
	JTI    string `json:"jti"`
}

type internalOKResponse struct {
	OK bool `json:"ok"`
}

type internalEpochsLookupRequest struct {
	SID          string `json:"sid"`
	AuthDeviceID string `json:"authDeviceId"`
}

type internalEpochsLookupResponse struct {
	SessionEpoch   int64 `json:"sessionEpoch"`
	DeviceEpoch    int64 `json:"deviceEpoch"`
	SessionRevoked bool  `json:"sessionRevoked"`
	DeviceRevoked  bool  `json:"deviceRevoked"`
}

func internalSessionUpsertHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if d.AuthSoT == nil || !d.AuthSoT.Mode.WritesEnabled() || d.AuthSoT.PG == nil {
			writeError(w, http.StatusServiceUnavailable, "PG_SOT_DISABLED", "Postgres SoT writes disabled")
			return
		}
		var req internalSessionUpsertRequest
		if err := readJSON(r, d.Config.HTTP.MaxBodyBytes, &req); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_JSON", "Invalid JSON")
			return
		}
		if strings.TrimSpace(req.SID) == "" || req.UserID <= 0 {
			writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "sid and userId required")
			return
		}
		if err := d.AuthSoT.PG.UpsertSession(r.Context(), authpg.SessionUpsertParams{
			SID: req.SID, UserID: req.UserID, RefreshJTI: req.RefreshJTI,
			IP: clientIP(r), UserAgent: pickUA(req.UserAgent, r),
		}); err != nil {
			d.Logger.Warn("internal session upsert failed", "err", err, "sid", req.SID)
			writeError(w, http.StatusServiceUnavailable, "PG_WRITE_FAILED", "Session SoT write failed")
			return
		}
		writeJSON(w, http.StatusOK, internalOKResponse{OK: true})
	}
}

func internalDeviceUpsertHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if d.AuthSoT == nil || !d.AuthSoT.Mode.WritesEnabled() || d.AuthSoT.PG == nil {
			writeError(w, http.StatusServiceUnavailable, "PG_SOT_DISABLED", "Postgres SoT writes disabled")
			return
		}
		var req internalDeviceUpsertRequest
		if err := readJSON(r, d.Config.HTTP.MaxBodyBytes, &req); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_JSON", "Invalid JSON")
			return
		}
		if strings.TrimSpace(req.AuthDeviceID) == "" || strings.TrimSpace(req.SID) == "" || req.UserID <= 0 {
			writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "authDeviceId, sid, userId required")
			return
		}
		if err := d.AuthSoT.PG.UpsertDevice(r.Context(), authpg.DeviceUpsertParams{
			AuthDeviceID: req.AuthDeviceID, SID: req.SID, UserID: req.UserID,
			PublicKeySPKI: req.PublicKeySPKI, UserAgent: pickUA(req.UserAgent, r),
		}); err != nil {
			d.Logger.Warn("internal device upsert failed", "err", err)
			writeError(w, http.StatusServiceUnavailable, "PG_WRITE_FAILED", "Device SoT write failed")
			return
		}
		writeJSON(w, http.StatusOK, internalOKResponse{OK: true})
	}
}

func internalEpochsLookupHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if d.AuthSoT == nil || d.AuthSoT.PG == nil {
			writeError(w, http.StatusServiceUnavailable, "PG_SOT_UNAVAILABLE", "Postgres SoT unavailable")
			return
		}
		var req internalEpochsLookupRequest
		if err := readJSON(r, d.Config.HTTP.MaxBodyBytes, &req); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_JSON", "Invalid JSON")
			return
		}
		if strings.TrimSpace(req.SID) == "" {
			writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "sid required")
			return
		}
		epochs, err := d.AuthSoT.PG.LookupProofEpochs(r.Context(), req.SID, req.AuthDeviceID)
		if err != nil {
			d.Logger.Warn("internal epochs lookup failed", "err", err, "sid", req.SID)
			writeError(w, http.StatusServiceUnavailable, "PG_READ_FAILED", "Epoch lookup failed")
			return
		}
		writeJSON(w, http.StatusOK, internalEpochsLookupResponse{
			SessionEpoch:   epochs.SessionEpoch,
			DeviceEpoch:    epochs.DeviceEpoch,
			SessionRevoked: epochs.SessionRevoked,
			DeviceRevoked:  epochs.DeviceRevoked,
		})
	}
}

func internalSessionRevokeHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req internalSessionRevokeRequest
		if err := readJSON(r, d.Config.HTTP.MaxBodyBytes, &req); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_JSON", "Invalid JSON")
			return
		}
		if strings.TrimSpace(req.SID) == "" {
			writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "sid required")
			return
		}
		if err := store.RevokeSessionViaSoT(r.Context(), d.AuthSoT, d.Redis, req.UserID, req.SID, req.JTI, store.RevokeReasonInternal); err != nil {
			d.Logger.Warn("internal session revoke failed", "err", err, "sid", req.SID)
			writeError(w, http.StatusServiceUnavailable, "REVOKE_FAILED", "Session revoke failed")
			return
		}
		writeJSON(w, http.StatusOK, internalOKResponse{OK: true})
	}
}

func clientIP(r *http.Request) string {
	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
		if i := strings.Index(xff, ","); i > 0 {
			return strings.TrimSpace(xff[:i])
		}
		return xff
	}
	return strings.TrimSpace(r.RemoteAddr)
}

func pickUA(explicit string, r *http.Request) string {
	if u := strings.TrimSpace(explicit); u != "" {
		return u
	}
	return strings.TrimSpace(r.Header.Get("User-Agent"))
}
