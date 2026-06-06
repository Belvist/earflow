package partygw

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	Port                int
	NATSURL             string
	ShardCount          int
	PartyGWShards       string
	WSTokenSecret       string
	JWTSecret           string
	ReqTimeout          time.Duration
	LeaveOnCloseTimeout time.Duration
	StateTouchInterval  time.Duration
}

func Load() Config {
	p := getInt("PORT", 3131)
	sc := getInt("PARTY_V2_SHARD_COUNT", 64)
	nc := os.Getenv("NATS_URL")
	if nc == "" {
		nc = "nats://nats:4222"
	}
	jwt := os.Getenv("JWT_SECRET")
	ws := os.Getenv("PARTY_V2_WS_TOKEN_SECRET")
	if ws == "" {
		ws = jwt
	}
	return Config{
		Port:                p,
		NATSURL:             nc,
		ShardCount:          sc,
		PartyGWShards:       os.Getenv("PARTY_V2_SHARDS"),
		WSTokenSecret:       ws,
		JWTSecret:           jwt,
		ReqTimeout:          1500 * time.Millisecond,
		LeaveOnCloseTimeout: 800 * time.Millisecond,
		StateTouchInterval:  time.Duration(getInt("PARTY_V2_STATE_TOUCH_INTERVAL_SECONDS", 60)) * time.Second,
	}
}

func getInt(k string, d int) int {
	v := os.Getenv(k)
	if v == "" {
		return d
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return d
	}
	return n
}
