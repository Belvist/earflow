package auth

import (
	"os"
	"strings"
)

// SoTMode mirrors security-service AUTH_PG_SOT_MODE (PEND-SEC-011).
type SoTMode string

const (
	SoTModeOff       SoTMode = "off"
	SoTModeDualWrite SoTMode = "dual_write"
)

func parseSoTMode() SoTMode {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv("AUTH_PG_SOT_MODE")))
	switch raw {
	case string(SoTModeDualWrite), "dual-write":
		return SoTModeDualWrite
	default:
		return SoTModeOff
	}
}

func (m SoTMode) WritesEnabled() bool {
	return m == SoTModeDualWrite
}
