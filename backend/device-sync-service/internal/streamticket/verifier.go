package streamticket

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"

	"github.com/earflow/music-platform/device-sync-service/internal/auth"
	"github.com/earflow/music-platform/device-sync-service/internal/config"
	"github.com/redis/go-redis/v9"
)

const (
	opaqueKeyPrefix     = "auth:stream_ticket:opaque:"
	ticketTypeWSConnect = "ws_connect_ticket"
)

var opaqueIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{20,128}$`)

type ticketScope struct {
	DeviceID string `json:"deviceId"`
	PartyID  string `json:"partyId"`
	RoomID   string `json:"roomId"`
}

type opaqueRecord struct {
	TicketType   string      `json:"ticketType"`
	SID          string      `json:"sid"`
	AuthDeviceID string      `json:"authDeviceId"`
	UserID       string      `json:"userId"`
	SessionEpoch int64       `json:"sessionEpoch"`
	DeviceEpoch  int64       `json:"deviceEpoch"`
	Scope        ticketScope `json:"scope"`
	OneTime      bool        `json:"oneTime"`
}

// Verifier validates WS upgrade tickets (legacy JWT + SEC-005 opaque).
type Verifier struct {
	cfg   *config.Config
	authR *redis.Client
	cache *EpochCache
}

func NewVerifier(cfg *config.Config, authR *redis.Client, cache *EpochCache) *Verifier {
	if cfg == nil || !cfg.StreamTicketEnabled() {
		return nil
	}
	return &Verifier{cfg: cfg, authR: authR, cache: cache}
}

func (v *Verifier) AcceptEnabled() bool {
	return v != nil && v.cfg.StreamTicket.Accept
}

func (v *Verifier) EnforceEnabled() bool {
	return v != nil && v.cfg.StreamTicket.Enforce
}

func looksLikeJWT(token string) bool {
	return strings.Count(token, ".") == 2
}

// VerifyUpgradeTicket returns claims for a ?ticket= value on /ws/devices.
func (v *Verifier) VerifyUpgradeTicket(ctx context.Context, cfg *config.Config, token string) (*auth.TicketClaims, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, errors.New("empty ticket")
	}

	if v != nil && v.AcceptEnabled() && !looksLikeJWT(token) {
		if claims, err := v.verifyOpaqueWS(ctx, token); err == nil && claims != nil {
			return claims, nil
		} else if v.EnforceEnabled() {
			return nil, errors.New("ws stream ticket required")
		}
	} else if v != nil && v.EnforceEnabled() {
		return nil, errors.New("ws stream ticket required")
	}

	return auth.VerifyTicket(cfg, token)
}

func (v *Verifier) verifyOpaqueWS(ctx context.Context, id string) (*auth.TicketClaims, error) {
	if v.authR == nil || v.cache == nil {
		return nil, errors.New("opaque verifier unavailable")
	}
	if !opaqueIDPattern.MatchString(id) {
		return nil, errors.New("invalid opaque id")
	}

	key := opaqueKeyPrefix + id
	raw, err := v.authR.GetDel(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		return nil, errors.New("opaque ticket missing")
	}
	if err != nil {
		return nil, err
	}

	var rec opaqueRecord
	if err := json.Unmarshal([]byte(raw), &rec); err != nil {
		return nil, errors.New("opaque ticket corrupt")
	}
	if strings.TrimSpace(rec.TicketType) != ticketTypeWSConnect {
		return nil, errors.New("wrong ticket type")
	}

	sid := strings.TrimSpace(rec.SID)
	userID := strings.TrimSpace(rec.UserID)
	deviceID := strings.TrimSpace(rec.Scope.DeviceID)
	if deviceID == "" {
		deviceID = strings.TrimSpace(rec.Scope.PartyID)
	}
	if deviceID == "" {
		deviceID = strings.TrimSpace(rec.Scope.RoomID)
	}
	if sid == "" || userID == "" || deviceID == "" {
		return nil, errors.New("opaque ticket incomplete")
	}

	if v.cache.IsSessionRevoked(sid) {
		return nil, errors.New("session revoked")
	}
	if v.cache.SessionEpochStale(sid, rec.SessionEpoch) {
		return nil, errors.New("session epoch stale")
	}
	if ad := strings.TrimSpace(rec.AuthDeviceID); ad != "" && v.cache.DeviceEpochStale(ad, rec.DeviceEpoch) {
		return nil, errors.New("device epoch stale")
	}

	return &auth.TicketClaims{
		UserID:   userID,
		DeviceID: deviceID,
	}, nil
}
