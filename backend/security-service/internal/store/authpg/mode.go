package authpg

import (
	"os"
	"strings"
)

// Mode controls Postgres SoT rollout (PEND-SEC-011).
type Mode string

const (
	ModeOff       Mode = "off"
	ModeDualWrite Mode = "dual_write"
	ModePGRead    Mode = "pg_read"
	ModePGOnly    Mode = "pg_only"
)

// ParseMode reads AUTH_PG_SOT_MODE (default off).
func ParseMode() Mode {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv("AUTH_PG_SOT_MODE")))
	switch raw {
	case string(ModeDualWrite), "dual-write":
		return ModeDualWrite
	case string(ModePGRead), "pg-read":
		return ModePGRead
	case string(ModePGOnly), "pg-only":
		return ModePGOnly
	default:
		return ModeOff
	}
}

func (m Mode) WritesEnabled() bool {
	return m == ModeDualWrite || m == ModePGRead || m == ModePGOnly
}

func (m Mode) ReadsEnabled() bool {
	return m == ModePGRead || m == ModePGOnly
}
