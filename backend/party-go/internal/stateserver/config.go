package stateserver

import (
	"os"
	"strconv"
	"time"
)

// Config from environment.
type Config struct {
	Port                 int
	RedisAddr            string
	RedisPassword        string
	RedisDB              int
	NATSURL              string
	JWTSecret            string
	// WSTokenSecret signs WebSocket access tokens; defaults to JWTSecret.
	WSTokenSecret        string
	SessionTTL           time.Duration
	InviteTTLLink        time.Duration
	InviteTTLKey         time.Duration
	ShardCount           int
	MaxPartiesPerUser    int
	MaxParticipants      int
}

func loadInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func mustSecret(env string) string {
	return os.Getenv(env)
}

// LoadConfig reads process env. Fails on missing required secrets in caller.
func LoadConfig() Config {
	ttlSec := loadInt("PARTY_V2_SESSION_TTL_SECONDS", 7200)
	invSec := loadInt("PARTY_V2_INVITE_TTL_SECONDS", 3600)
	port := loadInt("PORT", 3130)
	rdb := loadInt("REDIS_DB", 2)
	redisAddr := os.Getenv("REDIS_HOST")
	if redisAddr == "" {
		redisAddr = "redis"
	}
	rp := os.Getenv("REDIS_PORT")
	if rp == "" {
		rp = "6379"
	}
	redisPassword := os.Getenv("REDIS_PASSWORD")
	jwt := mustSecret("JWT_SECRET")
	ws := os.Getenv("PARTY_V2_WS_TOKEN_SECRET")
	if ws == "" {
		ws = jwt
	}
	nats := os.Getenv("NATS_URL")
	if nats == "" {
		nats = "nats://nats:4222"
	}
	if ws == "" {
		ws = jwt
	}
	sessionDur := time.Duration(ttlSec) * time.Second
	inviteDur := time.Duration(invSec) * time.Second
	// Invite keys must live at least as long as the party document, otherwise
	// join-by-code returns 404 while the session is still "active" (host sees
	// the party, Redis still has the doc, but code→partyId keys expired first).
	if inviteDur < sessionDur {
		inviteDur = sessionDur
	}
	return Config{
		Port:                 port,
		RedisAddr:            redisAddr + ":" + rp,
		RedisPassword:        redisPassword,
		RedisDB:              rdb,
		NATSURL:              nats,
		JWTSecret:            jwt,
		WSTokenSecret:        ws,
		SessionTTL:           sessionDur,
		InviteTTLLink:        inviteDur,
		InviteTTLKey:         inviteDur,
		ShardCount:           loadInt("PARTY_V2_SHARD_COUNT", 64),
		MaxPartiesPerUser:    loadInt("PARTY_MAX_PER_USER", 3),
		MaxParticipants:      loadInt("PARTY_MAX_PARTICIPANTS", 50),
	}
}
