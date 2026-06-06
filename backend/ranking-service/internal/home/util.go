package home

import (
	"crypto/sha256"
	"encoding/binary"
	"path"
	"regexp"
	"strings"
	"time"
)

var safeCoverNameRe = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

func computeSeed(raw string, userID int, now time.Time) string {
	seed := strings.TrimSpace(raw)
	if len(seed) > 128 {
		seed = seed[:128]
	}
	if seed == "" {
		bucketHour := now.UTC().Hour() / 6
		seed = now.UTC().Format("2006-01-02") + ":" + string(rune('0'+bucketHour))
	}
	if userID > 0 {
		return seed + ":u:" + itoa(userID)
	}
	return seed + ":anon"
}

func hashToBase36(input string) string {
	sum := sha256.Sum256([]byte(input))
	value := binary.BigEndian.Uint64(sum[:8])
	if value == 0 {
		return "0"
	}
	const digits = "0123456789abcdefghijklmnopqrstuvwxyz"
	buf := make([]byte, 0, 13)
	for value > 0 {
		buf = append(buf, digits[value%36])
		value /= 36
	}
	for i, j := 0, len(buf)-1; i < j; i, j = i+1, j-1 {
		buf[i], buf[j] = buf[j], buf[i]
	}
	return string(buf)
}

func normalizeCoverPath(raw *string) *string {
	if raw == nil {
		return nil
	}
	cover := strings.TrimSpace(*raw)
	if cover == "" {
		return nil
	}
	if strings.HasPrefix(cover, "http://") || strings.HasPrefix(cover, "https://") {
		return &cover
	}
	normalized := strings.TrimLeft(strings.ReplaceAll(cover, "\\", "/"), "/")
	filename := path.Base(normalized)
	if !isSafeCoverFilename(filename) {
		return nil
	}
	out := "/covers/" + filename
	return &out
}

func isSafeCoverFilename(filename string) bool {
	name := strings.TrimSpace(filename)
	if name == "" || len(name) > 200 {
		return false
	}
	if name == "." || name == ".." {
		return false
	}
	if strings.Contains(name, "/") || strings.Contains(name, "\\") || strings.Contains(name, "..") {
		return false
	}
	return safeCoverNameRe.MatchString(name)
}

func itoa(v int) string {
	if v == 0 {
		return "0"
	}
	neg := v < 0
	if neg {
		v = -v
	}
	buf := make([]byte, 0, 11)
	for v > 0 {
		buf = append(buf, byte('0'+v%10))
		v /= 10
	}
	if neg {
		buf = append(buf, '-')
	}
	for i, j := 0, len(buf)-1; i < j; i, j = i+1, j-1 {
		buf[i], buf[j] = buf[j], buf[i]
	}
	return string(buf)
}
