package httpapi

import (
	"net/http"
	"strings"

	"github.com/earflow/music-platform/security-service/internal/authz"
	"github.com/earflow/music-platform/security-service/internal/domain"
)

type listAuthDevicesResponse struct {
	Devices []domain.AuthDeviceView `json:"devices"`
}

func listAuthDevicesHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, ok := authz.FromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
			return
		}

		currentAuthDeviceID := strings.TrimSpace(r.Header.Get("X-Auth-Device-Id"))
		if currentAuthDeviceID == "" {
			currentAuthDeviceID = strings.TrimSpace(r.Header.Get("x-auth-device-id"))
		}

		devices := d.collectDecoratedAuthDevices(r, principal, currentAuthDeviceID)
		writeJSON(w, http.StatusOK, listAuthDevicesResponse{Devices: devices})
	}
}
