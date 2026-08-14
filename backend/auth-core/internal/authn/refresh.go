package authn

import (
	"context"
	"errors"
	"strings"

	"github.com/earflow/music-platform/auth-core/internal/store"
	"github.com/redis/go-redis/v9"
)

// RefreshResult is the rotation payload: { accessToken, refreshToken }.
type RefreshResult struct {
	AccessToken  string
	RefreshToken string
}

var errNoRefresh = errors.New("invalid refresh")

// Refresh rotates a refresh token, mirroring Node rotateRefreshSession:
// reuse detection (single jti per sid), grace window for the old token in the
// race window, atomic WATCH/MULTI. Watch() retries on transaction conflicts.
func (s *Service) Refresh(ctx context.Context, refreshToken string) (*RefreshResult, *APIError) {
	if strings.TrimSpace(refreshToken) == "" {
		return nil, &APIError{Status: 400, Message: "Refresh token обязателен", Code: "REFRESH_TOKEN_REQUIRED"}
	}
	if len(refreshToken) < 40 || len(refreshToken) > 4096 {
		return nil, &APIError{Status: 400, Message: "Некорректный refresh token", Code: "INVALID_REFRESH"}
	}

	claims, err := VerifyRefresh(s.JWTSecret, s.JWTIssuer, s.JWTAudience, refreshToken)
	if err != nil {
		return nil, &APIError{Status: 401, Message: "Недействительный refresh token", Code: "INVALID_REFRESH"}
	}
	if claims.Type != "refresh" || claims.UserID <= 0 || claims.SID == "" || claims.JTI == "" {
		return nil, &APIError{Status: 401, Message: "Недействительный refresh token", Code: "INVALID_REFRESH"}
	}

	sidKey := store.SIDKey(claims.SID)
	refreshKey := store.RefreshKey(claims.JTI)
	graceKey := store.GraceKey(claims.JTI)
	c := s.RD.Client()

	var result RefreshResult
	var reuseDetected bool

	err = c.Watch(ctx, func(tx *redis.Tx) error {
		currentJti, err := tx.Get(ctx, sidKey).Result()
		if err == redis.Nil {
			return errNoRefresh
		}
		if err != nil {
			return err
		}

		if currentJti != claims.JTI {
			// Old token arrives in the rotation race window: serve the grace payload.
			grace, gErr := s.RD.GetGrace(ctx, claims.JTI)
			if gErr == nil && grace != nil && grace.AccessToken != "" && grace.RefreshToken != "" {
				result = RefreshResult{AccessToken: grace.AccessToken, RefreshToken: grace.RefreshToken}
				return nil
			}
			// Reuse detected: kill the refresh binding.
			reuseDetected = true
			_ = s.RD.DeleteRefreshKey(ctx, claims.JTI)
			return errNoRefresh
		}

		sessionRaw, err := tx.Get(ctx, refreshKey).Result()
		if err == redis.Nil {
			return errNoRefresh
		}
		if err != nil {
			return err
		}

		var session store.RefreshSession
		if err := unmarshalJSON([]byte(sessionRaw), &session); err != nil {
			return errNoRefresh
		}

		isAdmin := s.resolveIsAdmin(ctx, claims.UserID, session.IsAdmin)

		newJti, err := NewHexBytes(16)
		if err != nil {
			return err
		}
		newRefreshToken, err := IssueRefreshToken(s.JWTSecret, s.JWTIssuer, s.JWTAudience, s.Auth.RefreshJWTExpire, claims.UserID, claims.SID, newJti)
		if err != nil {
			return err
		}
		ttl := s.refreshTTL(newRefreshToken)

		accessToken, err := IssueAccessToken(s.JWTSecret, s.JWTIssuer, s.JWTAudience, s.Auth.AccessJWTExpire, claims.UserID, claims.SID, isAdmin)
		if err != nil {
			return err
		}

		newSessionJSON := marshalJSON(store.RefreshSession{UserID: claims.UserID, SID: claims.SID, IsAdmin: isAdmin})
		graceJSON := marshalJSON(store.GracePayload{AccessToken: accessToken, RefreshToken: newRefreshToken})

		_, err = tx.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
			pipe.SetEx(ctx, store.RefreshKey(newJti), newSessionJSON, ttl)
			pipe.SetEx(ctx, sidKey, newJti, ttl)
			pipe.Del(ctx, refreshKey)
			pipe.SetEx(ctx, graceKey, graceJSON, s.Auth.GraceTTL)
			return nil
		})
		if err != nil {
			return err
		}

		result = RefreshResult{AccessToken: accessToken, RefreshToken: newRefreshToken}
		s.RD.TouchSessionMeta(ctx, claims.SID, ttl, ipFromCtx(ctx), uaFromCtx(ctx))
		s.RD.AddUserSID(ctx, claims.UserID, claims.SID, ttl)
		s.audit(ctx, "refresh_rotate", "userId", claims.UserID, "ip", ipFromCtx(ctx), "ua", uaFromCtx(ctx))
		return nil
	}, sidKey)

	if err != nil {
		if errors.Is(err, errNoRefresh) {
			if reuseDetected {
				s.audit(ctx, "refresh_reuse", "userId", claims.UserID, "sid", claims.SID, "ip", ipFromCtx(ctx), "ua", uaFromCtx(ctx))
			}
			return nil, &APIError{Status: 401, Message: "Недействительный refresh token", Code: "INVALID_REFRESH"}
		}
		return nil, ErrServiceUnavailable
	}

	if result.AccessToken == "" || result.RefreshToken == "" {
		return nil, ErrServiceUnavailable
	}
	return &result, nil
}
