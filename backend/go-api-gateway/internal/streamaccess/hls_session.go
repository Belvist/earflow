package streamaccess

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/earflow/music-platform/go-api-gateway/internal/service"
)

type Checker struct {
	databaseBase string
	tokens       *service.ServiceTokenManager
	hc           http.Client
}

type Decision struct {
	Allowed bool
	Status  int
	Error   string
	Code    string
}

type songDTO struct {
	ID     int `json:"id"`
	UserID int `json:"user_id"`
}

func NewChecker(databaseBase string, tokens *service.ServiceTokenManager) (*Checker, error) {
	base := strings.TrimRight(strings.TrimSpace(databaseBase), "/")
	if base == "" {
		return nil, errors.New("database base url is empty")
	}

	return &Checker{
		databaseBase: base,
		tokens:       tokens,
		hc: http.Client{
			Timeout: 4 * time.Second,
		},
	}, nil
}

func (c *Checker) CheckHlsSessionAccess(ctx context.Context, userID string, isAdmin bool, trackID int) Decision {
	uid := strings.TrimSpace(userID)
	if uid == "" {
		return Decision{Allowed: false, Status: http.StatusUnauthorized, Error: "Authentication required", Code: "NO_SESSION"}
	}
	if trackID <= 0 {
		return Decision{Allowed: false, Status: http.StatusBadRequest, Error: "Invalid trackId", Code: "INVALID_TRACK_ID"}
	}
	if isAdmin {
		return Decision{Allowed: true}
	}
	if c.tokens == nil {
		return Decision{Allowed: false, Status: http.StatusServiceUnavailable, Error: "Service temporarily unavailable", Code: "SERVICE_TOKEN_UNAVAILABLE"}
	}

	tok, err := c.tokens.GetToken(ctx)
	if err != nil || strings.TrimSpace(tok) == "" {
		return Decision{Allowed: false, Status: http.StatusServiceUnavailable, Error: "Service temporarily unavailable", Code: "SERVICE_TOKEN_UNAVAILABLE"}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.databaseBase+"/api/songs/"+strconv.Itoa(trackID), nil)
	if err != nil {
		return Decision{Allowed: false, Status: http.StatusServiceUnavailable, Error: "Service temporarily unavailable", Code: "SERVICE_UNAVAILABLE"}
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Service-Token", tok)
	req.Header.Set("x-service-token", tok)
	req.Header.Set("X-User-Id", uid)
	req.Header.Set("x-user-id", uid)

	resp, err := c.hc.Do(req)
	if err != nil {
		return Decision{Allowed: false, Status: http.StatusServiceUnavailable, Error: "Service temporarily unavailable", Code: "SERVICE_UNAVAILABLE"}
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return Decision{Allowed: false, Status: http.StatusNotFound, Error: "Track not found", Code: "TRACK_NOT_FOUND"}
	}
	if resp.StatusCode == http.StatusForbidden {
		return Decision{Allowed: false, Status: http.StatusForbidden, Error: "Access denied", Code: "ACCESS_DENIED"}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return Decision{Allowed: false, Status: http.StatusServiceUnavailable, Error: "Service temporarily unavailable", Code: "SERVICE_UNAVAILABLE"}
	}

	var dto songDTO
	dec := json.NewDecoder(resp.Body)
	if err := dec.Decode(&dto); err != nil {
		return Decision{Allowed: false, Status: http.StatusServiceUnavailable, Error: "Service temporarily unavailable", Code: "SERVICE_UNAVAILABLE"}
	}
	if dto.ID <= 0 {
		return Decision{Allowed: false, Status: http.StatusServiceUnavailable, Error: "Service temporarily unavailable", Code: "SERVICE_UNAVAILABLE"}
	}

	parsedUID, err := strconv.Atoi(uid)
	if err != nil || parsedUID <= 0 {
		return Decision{Allowed: false, Status: http.StatusUnauthorized, Error: "Authentication required", Code: "NO_SESSION"}
	}

	// database-service /api/songs/:id already rejects missing or unavailable tracks.
	// HLS must follow the same playback policy as direct-stream: any authenticated
	// user can play available public catalog tracks, not only the uploader.
	return Decision{Allowed: true}
}
