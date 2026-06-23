package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/earflow/music-platform/security-service/internal/authz"
	"github.com/earflow/music-platform/security-service/internal/domain"
	"github.com/earflow/music-platform/security-service/internal/store"
	"github.com/earflow/music-platform/security-service/internal/store/authpg"
)

// enumerateSessionSIDs merges Redis index, PG SoT (dual_write+), and the caller sid.
func (d Deps) enumerateSessionSIDs(r *http.Request, userID int64, principalSID string) []string {
	seen := map[string]struct{}{}
	ordered := make([]string, 0, 8)
	add := func(sid string) {
		sid = strings.TrimSpace(sid)
		if sid == "" {
			return
		}
		if _, ok := seen[sid]; ok {
			return
		}
		seen[sid] = struct{}{}
		ordered = append(ordered, sid)
	}

	add(principalSID)
	if sids, err := d.Redis.EnumerateUserSids(r.Context(), userID); err != nil {
		d.Logger.Warn("sessions: enumerate failed", "err", err)
	} else {
		for _, sid := range sids {
			add(sid)
		}
	}
	if d.AuthSoT != nil && d.AuthSoT.Mode.WritesEnabled() && d.AuthSoT.PG != nil {
		pgSids, err := d.AuthSoT.PG.ListActiveSessionSIDs(r.Context(), userID)
		if err != nil {
			d.Logger.Warn("sessions: pg enumerate failed", "err", err)
		} else {
			for _, sid := range pgSids {
				add(sid)
			}
		}
	}

	max := d.Config.Security.MaxSessionsList
	if max > 0 && len(ordered) > max {
		return ordered[:max]
	}
	return ordered
}

// authDeviceBindings maps sid → authDeviceId for the user's active PoP devices,
// so the client can group duplicate sessions of the same browser into one card.
func (d Deps) authDeviceBindings(r *http.Request, userID int64) map[string]string {
	bindings := map[string]string{}
	if d.AuthSoT == nil || !d.AuthSoT.Mode.WritesEnabled() || d.AuthSoT.PG == nil {
		return bindings
	}
	rows, err := d.AuthSoT.PG.ListActiveAuthDevices(r.Context(), userID)
	if err != nil {
		d.Logger.Warn("sessions: device bindings failed", "err", err, "userId", userID)
		return bindings
	}
	for _, row := range rows {
		if row.SID != "" && row.AuthDeviceID != "" {
			bindings[row.SID] = row.AuthDeviceID
		}
	}
	return bindings
}

// collectDecoratedSessions enumerates the user's sessions and decorates them
// with UI-ready labels. Cleans up dead sids from the index as it iterates.
func (d Deps) collectDecoratedSessions(r *http.Request, principal authz.Principal) []domain.SessionView {
	ordered := d.enumerateSessionSIDs(r, principal.UserID, principal.SID)
	bindings := d.authDeviceBindings(r, principal.UserID)

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
			if d.Redis.GatewaySessionExists(r.Context(), sid) {
				info = &store.SessionInfo{SID: sid, MetaMissing: true}
				if d.AuthSoT != nil && d.AuthSoT.PG != nil {
					if pgRow, pgErr := d.AuthSoT.PG.GetActiveSession(r.Context(), sid); pgErr != nil {
						d.Logger.Warn("sessions: pg read failed", "err", pgErr, "sid", sid)
					} else if pgRow != nil {
						info.JTI = pgRow.RefreshJTI
						info.IP = pgRow.IP
						info.UA = pgRow.UserAgent
						if !pgRow.CreatedAt.IsZero() {
							info.CreatedAt = pgRow.CreatedAt.UTC().Format(time.RFC3339)
						}
						if !pgRow.LastSeenAt.IsZero() {
							info.LastSeenAt = pgRow.LastSeenAt.UTC().Format(time.RFC3339)
						}
					}
				}
			} else if pgRow := d.loadPGSessionOrNil(r, sid); pgRow != nil {
				info = &store.SessionInfo{
					SID:        sid,
					JTI:        pgRow.RefreshJTI,
					IP:         pgRow.IP,
					UA:         pgRow.UserAgent,
					MetaMissing: true,
				}
				if !pgRow.CreatedAt.IsZero() {
					info.CreatedAt = pgRow.CreatedAt.UTC().Format(time.RFC3339)
				}
				if !pgRow.LastSeenAt.IsZero() {
					info.LastSeenAt = pgRow.LastSeenAt.UTC().Format(time.RFC3339)
				}
			} else {
				dead = append(dead, sid)
				continue
			}
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
		view.AuthDeviceID = bindings[sid]
		views = append(views, view)
	}

	if len(dead) > 0 {
		d.Redis.CleanupDeadSids(r.Context(), principal.UserID, dead)
	}
	domain.SortSessions(views)
	return views
}

const freshLoginProtectionWindow = 24 * time.Hour

func (d Deps) sessionCreatedAt(r *http.Request, sid string) (time.Time, bool) {
	sid = strings.TrimSpace(sid)
	if sid == "" {
		return time.Time{}, false
	}
	if row := d.loadPGSessionOrNil(r, sid); row != nil && !row.CreatedAt.IsZero() {
		return row.CreatedAt.UTC(), true
	}
	info, err := d.Redis.ReadSessionInfo(r.Context(), sid)
	if err != nil || info == nil || strings.TrimSpace(info.CreatedAt) == "" {
		return time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339, strings.TrimSpace(info.CreatedAt))
	if err != nil {
		return time.Time{}, false
	}
	return t.UTC(), true
}

func (d Deps) isFreshLoginSession(r *http.Request, sid string) bool {
	createdAt, ok := d.sessionCreatedAt(r, sid)
	if !ok {
		return false
	}
	return time.Since(createdAt) < freshLoginProtectionWindow
}

func (d Deps) requireStepUpForSensitiveSessionAction(w http.ResponseWriter, r *http.Request, principal authz.Principal, massRevoke bool) bool {
	if massRevoke && d.isFreshLoginSession(r, principal.SID) && !stepUpOK(d, r, principal) {
		writeError(w, http.StatusForbidden, "FRESH_LOGIN_REQUIRED", "Fresh session requires step-up before revoking other sessions")
		return false
	}
	mfaRequired, abort := d.userMFAStepUpRequired(r, principal.UserID)
	if abort {
		writeError(w, http.StatusNotFound, "USER_NOT_FOUND", "User not found")
		return false
	}
	if mfaRequired && !stepUpOK(d, r, principal) {
		writeError(w, http.StatusForbidden, "MFA_STEP_UP_REQUIRED", "Step-up required")
		return false
	}
	return true
}

func (d Deps) loadPGSessionOrNil(r *http.Request, sid string) *authpg.ActiveSessionRow {
	if d.AuthSoT == nil || d.AuthSoT.PG == nil {
		return nil
	}
	row, err := d.AuthSoT.PG.GetActiveSession(r.Context(), sid)
	if err != nil {
		d.Logger.Warn("sessions: pg read failed", "err", err, "sid", sid)
		return nil
	}
	return row
}

// userMFAStepUpRequired loads MFA flag for session revoke. On transient Postgres errors
// returns (false, false) so revoke can proceed; on missing user returns (_, true).
func (d Deps) userMFAStepUpRequired(r *http.Request, userID int64) (mfaEnabled bool, abort bool) {
	if d.Postgres == nil {
		return false, false
	}
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
	for _, candidate := range d.enumerateSessionSIDs(r, userID, "") {
		if candidate == sid {
			return true
		}
	}
	return d.Redis.SessionOwnedByUser(r.Context(), sid, userID)
}
