package auth

import (
	"errors"
	"strings"
	"time"

	"github.com/earflow/music-platform/device-sync-service/internal/config"
	"github.com/golang-jwt/jwt/v5"
)

// Short-lived ticket used to upgrade a WebSocket. The primary JWT (which has
// full refresh/access privileges) MUST NOT leak into query strings or
// intermediate logs; a ticket carries only the minimum needed to bind the
// socket: userID + deviceID + audience.
const (
	ticketAudience = "device-sync-ws"
	ticketIssuer   = "device-sync-service"
)

// Ticket is what the client receives via POST /api/devices/ws-ticket.
type Ticket struct {
	Token      string `json:"token"`
	ExpiresAt  string `json:"expiresAt"`
	TTLSeconds int    `json:"ttlSeconds"`
}

// TicketClaims is the decoded form returned by VerifyTicket.
type TicketClaims struct {
	UserID   string
	DeviceID string
	Username string
}

// CreateTicket signs a ticket. Errors here are considered fatal for the
// request (caller returns 500) — they imply either a misconfigured secret or
// a corrupt clock.
func CreateTicket(cfg *config.Config, userID, deviceID, username string) (Ticket, error) {
	uid := strings.TrimSpace(userID)
	did := strings.TrimSpace(deviceID)
	if uid == "" {
		return Ticket{}, errors.New("empty userID")
	}
	if did == "" {
		return Ticket{}, errors.New("empty deviceID")
	}

	now := time.Now()
	exp := now.Add(cfg.WSTicketTTL)
	claims := jwt.MapClaims{
		"sub":      uid,
		"deviceId": did,
		"iat":      now.Unix(),
		"exp":      exp.Unix(),
		"aud":      ticketAudience,
		"iss":      ticketIssuer,
	}
	if len(username) > 64 {
		username = username[:64]
	}
	if username != "" {
		claims["username"] = username
	}

	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := tok.SignedString(cfg.WSTicketSecret)
	if err != nil {
		return Ticket{}, err
	}
	return Ticket{
		Token:      signed,
		ExpiresAt:  exp.UTC().Format(time.RFC3339),
		TTLSeconds: int(cfg.WSTicketTTL.Seconds()),
	}, nil
}

// VerifyTicket validates a token presented as ?ticket=… on the WS upgrade
// URL. Returns opaque errors on any failure to avoid leaking details to an
// untrusted peer.
func VerifyTicket(cfg *config.Config, token string) (*TicketClaims, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, errors.New("empty ticket")
	}
	parsed, err := jwt.Parse(token, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return cfg.WSTicketSecret, nil
	}, jwt.WithValidMethods([]string{"HS256"}),
		jwt.WithAudience(ticketAudience),
		jwt.WithIssuer(ticketIssuer),
	)
	if err != nil || !parsed.Valid {
		return nil, errors.New("invalid ticket")
	}
	claims, ok := parsed.Claims.(jwt.MapClaims)
	if !ok {
		return nil, errors.New("invalid ticket claims")
	}
	uid, _ := claims["sub"].(string)
	did, _ := claims["deviceId"].(string)
	uname, _ := claims["username"].(string)
	if uid == "" || did == "" {
		return nil, errors.New("malformed ticket")
	}
	return &TicketClaims{UserID: uid, DeviceID: did, Username: uname}, nil
}
