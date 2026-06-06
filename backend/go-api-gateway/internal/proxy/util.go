package proxy

import (
	"os"
	"strconv"
	"strings"
	"time"
)

var startedAt = time.Now()

func getenvFirst(keys ...string) string {
	for _, k := range keys {
		v := strings.TrimSpace(os.Getenv(k))
		if v != "" {
			return v
		}
	}
	return ""
}

func escapeJSON(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "\"", "\\\"")
	return s
}

func itoa(v int) string {
	return strconv.Itoa(v)
}
