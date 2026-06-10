package httpapi

import (
	"net/http"
	"time"

	"github.com/earflow/music-platform/security-service/internal/authz"
	"github.com/earflow/music-platform/security-service/internal/domain"
)

func (d Deps) collectDecoratedAuthDevices(r *http.Request, principal authz.Principal, currentAuthDeviceID string) []domain.AuthDeviceView {
	if d.AuthSoT == nil || d.AuthSoT.PG == nil {
		return []domain.AuthDeviceView{}
	}

	rows, err := d.AuthSoT.PG.ListActiveAuthDevices(r.Context(), principal.UserID)
	if err != nil {
		d.Logger.Warn("auth-devices: pg list failed", "err", err, "userId", principal.UserID)
		return []domain.AuthDeviceView{}
	}

	now := time.Now().UTC()
	views := make([]domain.AuthDeviceView, 0, len(rows))
	for _, row := range rows {
		views = append(views, domain.DecorateAuthDevice(
			row.AuthDeviceID,
			row.SID,
			row.UserAgent,
			currentAuthDeviceID,
			principal.SID,
			row.CreatedAt,
			row.LastSeenAt,
			now,
		))
	}

	max := d.Config.Security.MaxSessionsList
	if max > 0 && len(views) > max {
		views = views[:max]
	}
	domain.SortAuthDevices(views)
	return views
}
