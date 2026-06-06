package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/earflow/music-platform/security-service/internal/authz"
	"github.com/earflow/music-platform/security-service/internal/domain"
	"github.com/earflow/music-platform/security-service/internal/store"
)

// collectDecoratedSessions enumerates the user's sessions and decorates them
// with UI-ready labels. Cleans up dead sids from the index as it iterates.
func (d Deps) collectDecoratedSessions(r *http.Request, principal authz.Principal) []domain.SessionView {
	sids, err := d.Redis.EnumerateUserSids(r.Context(), principal.UserID)
	if err != nil {
		d.Logger.Warn("sessions: enumerate failed", "err", err)
	}

	seen := map[string]struct{}{principal.SID: {}}
	ordered := []string{principal.SID}
	for _, sid := range sids {
		if sid == "" {
			continue
		}
		if _, ok := seen[sid]; ok {
			continue
		}
		seen[sid] = struct{}{}
		ordered = append(ordered, sid)
		if len(ordered) >= d.Config.Security.MaxSessionsList {
			break
		}
	}

	now := time.Now().UTC()
	views := make([]domain.SessionView, 0, len(ordered))
	dead := make([]string, 0)

	for _, sid := range ordered {
		info, err := d.Redis.ReadSessionInfo(r.Context(), sid)
		if err != nil {
			d.Logger.Warn("sessions: read failed", "err", err, "sid", sid)
			continue
		}
		if info == nil {
			dead = append(dead, sid)
			continue
		}
		view := domain.DecorateSession(
			info.SID,
			info.JTI,
			info.TTLSeconds,
			info.CreatedAt,
			info.LastSeenAt,
			info.IP,
			info.UA,
			principal.SID,
			now,
		)
		views = append(views, view)
	}

	if len(dead) > 0 {
		d.Redis.CleanupDeadSids(r.Context(), principal.UserID, dead)
	}
	domain.SortSessions(views)
	return views
}

// userMFAStepUpRequired loads MFA flag for session revoke. On transient Postgres errors
// returns (false, false) so revoke can proceed; on missing user returns (_, true).
func (d Deps) userMFAStepUpRequired(r *http.Request, userID int64) (mfaEnabled bool, abort bool) {
	user, err := d.Postgres.GetUserByID(r.Context(), userID)
	if err != nil {
		if err == store.ErrUserNotFound {
			return false, true
		}
		d.Logger.Warn("sessions: mfa lookup failed, proceeding without mfa gate", "err", err, "userId", userID)
		return false, false
	}
	return user.MFAEnabled, false
}

func (d Deps) sessionBelongsToUser(r *http.Request, userID int64, sid string) bool {
	sid = strings.TrimSpace(sid)
	if sid == "" || userID <= 0 {
		return false
	}
	sids, err := d.Redis.EnumerateUserSids(r.Context(), userID)
	if err != nil {
		d.Logger.Warn("sessions: enumerate failed", "err", err)
	}
	for _, candidate := range sids {
		if strings.TrimSpace(candidate) == sid {
			return true
		}
	}
	return d.Redis.SessionOwnedByUser(r.Context(), sid, userID)
}
