package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var streamTicketLogger = slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

const (
	envStreamTicketEnabled      = "STREAM_TICKET_ENABLED"
	envStreamTicketObserve      = "STREAM_TICKET_OBSERVE"
	envStreamTicketSessionTTL   = "STREAM_TICKET_SESSION_TTL_SECONDS"
	envStreamTicketMediaTTL     = "STREAM_TICKET_MEDIA_TTL_SECONDS"
	envStreamTicketWSTTL        = "STREAM_TICKET_WS_TTL_SECONDS"
	streamTicketRedisKeyPrefix  = "auth:stream_ticket:opaque:"
	streamTicketTypeSession     = "stream_session_ticket"
	streamTicketTypeMedia       = "media_access_ticket"
	streamTicketTypeWSConnect   = "ws_connect_ticket"
	streamTicketJWTTypeSession  = "stream_session_ticket"
	streamTicketAudSession      = "earflow-stream-session"
	streamTicketKindStreamSess  = "stream_session"
	streamTicketKindMedia       = "media"
	streamTicketKindWS          = "ws"
	defaultStreamSessionTTL     = 90 * time.Second
	defaultStreamMediaTTL       = 90 * time.Second
	defaultStreamWSTTL          = 60 * time.Second
	minStreamTicketTTL          = 15 * time.Second
	maxStreamTicketTTL          = 120 * time.Second
)

type streamTicketScope struct {
	SessionID string `json:"sessionId,omitempty"`
	TrackID   string `json:"trackId,omitempty"`
	PartyID   string `json:"partyId,omitempty"`
	DeviceID  string `json:"deviceId,omitempty"`
	RoomID    string `json:"roomId,omitempty"`
}

type streamTicketMintRequest struct {
	Kind   string            `json:"kind"`
	Scope  streamTicketScope `json:"scope"`
	Client string            `json:"client"`
}

type streamTicketMintResponse struct {
	Ticket     string `json:"ticket"`
	TicketType string `json:"ticketType"`
	Transport  string `json:"transport"`
	ExpiresIn  int64  `json:"expiresIn"`
	ExpiresAt  string `json:"expiresAt"`
}

type opaqueStreamTicketRecord struct {
	TicketType   string            `json:"ticketType"`
	SID          string            `json:"sid"`
	AuthDeviceID string            `json:"authDeviceId"`
	UserID       string            `json:"userId"`
	SessionEpoch int64             `json:"sessionEpoch"`
	DeviceEpoch  int64             `json:"deviceEpoch"`
	Scope        streamTicketScope `json:"scope"`
	OneTime      bool              `json:"oneTime"`
}

func streamTicketEnabled() bool {
	v := strings.TrimSpace(os.Getenv(envStreamTicketEnabled))
	return v == "1" || strings.EqualFold(v, "true")
}

func streamTicketObserveEnabled() bool {
	v := strings.TrimSpace(os.Getenv(envStreamTicketObserve))
	return v == "1" || strings.EqualFold(v, "true")
}

func logStreamTicketMint(kind, ticketType, transport, userID string, expiresIn int64) {
	if !streamTicketObserveEnabled() {
		return
	}
	uid := strings.TrimSpace(userID)
	if len(uid) > 12 {
		uid = uid[:12] + "…"
	}
	streamTicketLogger.Info("stream_ticket_mint",
		slog.String("kind", strings.TrimSpace(kind)),
		slog.String("ticketType", strings.TrimSpace(ticketType)),
		slog.String("transport", strings.TrimSpace(transport)),
		slog.Int64("expiresIn", expiresIn),
		slog.String("userId", uid),
	)
}

func streamTicketTTLSeconds(envKey string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(envKey))
	if raw == "" {
		return fallback
	}
	sec, err := strconv.Atoi(raw)
	if err != nil || sec < int(minStreamTicketTTL.Seconds()) || sec > int(maxStreamTicketTTL.Seconds()) {
		return fallback
	}
	return time.Duration(sec) * time.Second
}

func requestUsedFullDeviceProof(r *http.Request) bool {
	return strings.TrimSpace(r.Header.Get(headerAuthDeviceProof)) != "" &&
		strings.TrimSpace(r.Header.Get(headerAuthDeviceTs)) != "" &&
		strings.TrimSpace(r.Header.Get(headerAuthDeviceNonce)) != ""
}

func normalizeStreamTicketKind(kind string) (string, error) {
	switch strings.TrimSpace(kind) {
	case streamTicketKindStreamSess, streamTicketKindMedia, streamTicketKindWS:
		return strings.TrimSpace(kind), nil
	default:
		return "", errors.New("invalid stream ticket kind")
	}
}

func validateStreamTicketScope(kind string, scope streamTicketScope) error {
	scope.SessionID = strings.TrimSpace(scope.SessionID)
	scope.TrackID = strings.TrimSpace(scope.TrackID)
	scope.PartyID = strings.TrimSpace(scope.PartyID)
	scope.DeviceID = strings.TrimSpace(scope.DeviceID)
	scope.RoomID = strings.TrimSpace(scope.RoomID)

	switch kind {
	case streamTicketKindStreamSess:
		if scope.SessionID == "" || scope.TrackID == "" {
			return errors.New("stream_session scope requires sessionId and trackId")
		}
	case streamTicketKindMedia:
		if scope.SessionID == "" || scope.TrackID == "" {
			return errors.New("media scope requires sessionId and trackId")
		}
	case streamTicketKindWS:
		if scope.DeviceID == "" && scope.PartyID == "" && scope.RoomID == "" {
			return errors.New("ws scope requires deviceId, partyId, or roomId")
		}
	}
	return nil
}

func newOpaqueStreamTicketID() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func opaqueStreamTicketRedisKey(id string) string {
	return streamTicketRedisKeyPrefix + strings.TrimSpace(id)
}

func (m *SessionManager) storeOpaqueStreamTicket(ctx context.Context, id string, rec opaqueStreamTicketRecord, ttl time.Duration) error {
	if m == nil || m.rdb == nil {
		return errors.New("opaque ticket store unavailable")
	}
	b, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	return m.rdb.Set(ctx, opaqueStreamTicketRedisKey(id), string(b), ttl).Err()
}

func (m *SessionManager) issueStreamSessionTicketJWT(userID, sid, authDeviceID string, epochs ProofEpochLookup, scope streamTicketScope, ttl time.Duration) (string, time.Time, error) {
	if m == nil {
		return "", time.Time{}, errors.New("session manager unavailable")
	}
	now := time.Now().UTC()
	exp := now.Add(ttl)
	scopeJSON, err := json.Marshal(scope)
	if err != nil {
		return "", time.Time{}, err
	}
	claims := jwt.MapClaims{
		"type":         streamTicketJWTTypeSession,
		"sid":          strings.TrimSpace(sid),
		"authDeviceId": strings.TrimSpace(authDeviceID),
		"sessionEpoch": epochs.SessionEpoch,
		"deviceEpoch":  epochs.DeviceEpoch,
		"scope":        json.RawMessage(scopeJSON),
		"iat":          now.Unix(),
		"exp":          exp.Unix(),
	}
	if uid := strings.TrimSpace(userID); uid != "" {
		claims["sub"] = uid
	}
	if iss := strings.TrimSpace(m.jwtIssuer); iss != "" {
		claims["iss"] = iss
	}
	claims["aud"] = streamTicketAudSession

	// v1: HS256 with gateway secret — temporary per SEC-005 DECISIONS; asymmetric JWKS is target.
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(m.jwtSecret))
	if err != nil {
		return "", time.Time{}, err
	}
	if m.proofEpochs != nil {
		m.proofEpochs.remember(sid, authDeviceID, epochs.SessionEpoch, epochs.DeviceEpoch)
	}
	return signed, exp, nil
}

func (m *SessionManager) mintStreamTicket(ctx context.Context, r *http.Request, sid, userID, authDeviceID string, req streamTicketMintRequest) (streamTicketMintResponse, error) {
	kind, err := normalizeStreamTicketKind(req.Kind)
	if err != nil {
		return streamTicketMintResponse{}, err
	}
	if err := validateStreamTicketScope(kind, req.Scope); err != nil {
		return streamTicketMintResponse{}, err
	}
	if kind == streamTicketKindWS && !requestUsedFullDeviceProof(r) {
		return streamTicketMintResponse{}, errDeviceProofRequired
	}

	epochs, err := m.lookupProofEpochs(ctx, sid, authDeviceID)
	if err != nil {
		epochs = ProofEpochLookup{}
		if m.proofEpochs != nil {
			se, de := m.proofEpochs.snapshot(sid, authDeviceID)
			epochs.SessionEpoch = se
			epochs.DeviceEpoch = de
		}
	}
	if epochs.SessionRevoked || epochs.DeviceRevoked {
		return streamTicketMintResponse{}, errDeviceRevoked
	}

	switch kind {
	case streamTicketKindStreamSess:
		ttl := streamTicketTTLSeconds(envStreamTicketSessionTTL, defaultStreamSessionTTL)
		token, exp, err := m.issueStreamSessionTicketJWT(userID, sid, authDeviceID, epochs, req.Scope, ttl)
		if err != nil {
			return streamTicketMintResponse{}, err
		}
		return streamTicketMintResponse{
			Ticket:     token,
			TicketType: streamTicketTypeSession,
			Transport:  "header",
			ExpiresIn:  int64(time.Until(exp).Seconds()),
			ExpiresAt:  exp.UTC().Format(time.RFC3339),
		}, nil
	case streamTicketKindMedia:
		ttl := streamTicketTTLSeconds(envStreamTicketMediaTTL, defaultStreamMediaTTL)
		id, err := newOpaqueStreamTicketID()
		if err != nil {
			return streamTicketMintResponse{}, err
		}
		rec := opaqueStreamTicketRecord{
			TicketType:   streamTicketTypeMedia,
			SID:          sid,
			AuthDeviceID: authDeviceID,
			UserID:       userID,
			SessionEpoch: epochs.SessionEpoch,
			DeviceEpoch:  epochs.DeviceEpoch,
			Scope:        req.Scope,
			OneTime:      false,
		}
		if err := m.storeOpaqueStreamTicket(ctx, id, rec, ttl); err != nil {
			return streamTicketMintResponse{}, err
		}
		exp := time.Now().UTC().Add(ttl)
		return streamTicketMintResponse{
			Ticket:     id,
			TicketType: streamTicketTypeMedia,
			Transport:  "query",
			ExpiresIn:  int64(ttl.Seconds()),
			ExpiresAt:  exp.UTC().Format(time.RFC3339),
		}, nil
	case streamTicketKindWS:
		ttl := streamTicketTTLSeconds(envStreamTicketWSTTL, defaultStreamWSTTL)
		id, err := newOpaqueStreamTicketID()
		if err != nil {
			return streamTicketMintResponse{}, err
		}
		rec := opaqueStreamTicketRecord{
			TicketType:   streamTicketTypeWSConnect,
			SID:          sid,
			AuthDeviceID: authDeviceID,
			UserID:       userID,
			SessionEpoch: epochs.SessionEpoch,
			DeviceEpoch:  epochs.DeviceEpoch,
			Scope:        req.Scope,
			OneTime:      true,
		}
		if err := m.storeOpaqueStreamTicket(ctx, id, rec, ttl); err != nil {
			return streamTicketMintResponse{}, err
		}
		exp := time.Now().UTC().Add(ttl)
		return streamTicketMintResponse{
			Ticket:     id,
			TicketType: streamTicketTypeWSConnect,
			Transport:  "query",
			ExpiresIn:  int64(ttl.Seconds()),
			ExpiresAt:  exp.UTC().Format(time.RFC3339),
		}, nil
	default:
		return streamTicketMintResponse{}, fmt.Errorf("unsupported kind %q", kind)
	}
}
