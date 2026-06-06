package recoverycodes

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// Generate creates `count` recovery codes, each derived from `bytesPerCode`
// random bytes, base64url-encoded and uppercased — identical to the Node
// reference implementation in lib/mfa/recoveryCodes.js.
func Generate(count, bytesPerCode int) ([]string, error) {
	if count < 6 || count > 20 {
		return nil, errors.New("generate: invalid count")
	}
	if bytesPerCode < 8 || bytesPerCode > 16 {
		return nil, errors.New("generate: invalid bytesPerCode")
	}

	out := make([]string, 0, count)
	buf := make([]byte, bytesPerCode)
	for i := 0; i < count; i++ {
		if _, err := rand.Read(buf); err != nil {
			return nil, fmt.Errorf("generate: rand: %w", err)
		}
		encoded := base64.RawURLEncoding.EncodeToString(buf)
		out = append(out, strings.ToUpper(encoded))
	}
	return out, nil
}

// Hash returns the hex SHA-256 digest of `${salt}:${CODE_UPPER}`.
// This mirrors Node's hashRecoveryCode exactly.
func Hash(salt, code string) string {
	s := strings.TrimSpace(salt)
	c := strings.ToUpper(strings.TrimSpace(code))
	if s == "" || c == "" {
		return ""
	}
	h := sha256.Sum256([]byte(s + ":" + c))
	return hex.EncodeToString(h[:])
}

// HashAll hashes a slice of codes.
func HashAll(salt string, codes []string) ([]string, error) {
	out := make([]string, 0, len(codes))
	for _, c := range codes {
		h := Hash(salt, c)
		if h == "" {
			return nil, errors.New("hashAll: empty salt or code")
		}
		out = append(out, h)
	}
	return out, nil
}

// CountRemaining parses a JSON-encoded array of hex hashes and counts non-empty.
func CountRemaining(raw string) int {
	s := strings.TrimSpace(raw)
	if s == "" {
		return 0
	}
	var arr []string
	if err := json.Unmarshal([]byte(s), &arr); err != nil {
		return 0
	}
	count := 0
	for _, v := range arr {
		if strings.TrimSpace(v) != "" {
			count++
		}
	}
	return count
}

// MarshalHashes encodes the hashes array as a JSON string for DB storage.
func MarshalHashes(hashes []string) (string, error) {
	b, err := json.Marshal(hashes)
	if err != nil {
		return "", err
	}
	return string(b), nil
}
