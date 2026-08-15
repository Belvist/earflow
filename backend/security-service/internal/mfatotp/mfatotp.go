// Package mfatotp implements RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30s step)
// byte-compatible with the Node reference implementation in
// backend/auth-service/lib/mfa/{totp.js,base32.js}.
package mfatotp

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
)

const (
	defaultDigits      = 6
	defaultStepSeconds = 30
	defaultWindow      = 1
	secretMinBytes     = 16
	secretMaxBytes     = 64
)

// GenerateSecretBase32 returns a random secret encoded as unpadded base32.
// The default 20 bytes yields a 32-character secret.
func GenerateSecretBase32(bytes int) (string, error) {
	if bytes < secretMinBytes || bytes > secretMaxBytes {
		return "", errors.New("generateSecretBase32: invalid bytes")
	}
	buf := make([]byte, bytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generateSecretBase32: rand: %w", err)
	}
	return encodeBase32(buf), nil
}

// encodeBase32 encodes bytes using RFC 4648 without padding (Node toBase32).
func encodeBase32(in []byte) string {
	return strings.TrimRight(base32.StdEncoding.EncodeToString(in), "=")
}

// decodeBase32 decodes unpadded base32 (Node fromBase32).
func decodeBase32(raw string) ([]byte, error) {
	s := strings.ToUpper(strings.TrimSpace(raw))
	s = strings.ReplaceAll(s, " ", "")
	s = strings.TrimRight(s, "=")
	if s == "" {
		return nil, errors.New("fromBase32: empty input")
	}
	pad := (8 - len(s)%8) % 8
	decoded, err := base32.StdEncoding.DecodeString(s + strings.Repeat("=", pad))
	if err != nil {
		return nil, errors.New("fromBase32: invalid character")
	}
	return decoded, nil
}

// hotp computes a HOTP value for the given key and counter (RFC 4226).
func hotp(key []byte, counter uint64, digits int) string {
	var counterBytes [8]byte
	for i := 7; i >= 0; i-- {
		counterBytes[i] = byte(counter & 0xff)
		counter >>= 8
	}
	mac := hmac.New(sha1.New, key)
	_, _ = mac.Write(counterBytes[:])
	sum := mac.Sum(nil)

	offset := sum[len(sum)-1] & 0x0f
	bin := (int64(sum[offset])&0x7f)<<24 |
		(int64(sum[offset+1])&0xff)<<16 |
		(int64(sum[offset+2])&0xff)<<8 |
		(int64(sum[offset+3]) & 0xff)

	mod := int64(1)
	for i := 0; i < digits; i++ {
		mod *= 10
	}
	return fmt.Sprintf("%0*d", digits, bin%mod)
}

// TOTP computes the current one-time password for a secret at time t.
func TOTP(secretBase32 string, t time.Time, stepSeconds, digits int) (string, error) {
	if stepSeconds < 15 || stepSeconds > 120 {
		return "", errors.New("totp: invalid stepSeconds")
	}
	if digits < 6 || digits > 8 {
		return "", errors.New("totp: invalid digits")
	}
	key, err := decodeBase32(secretBase32)
	if err != nil {
		return "", err
	}
	counter := uint64(t.Unix()) / uint64(stepSeconds)
	return hotp(key, counter, digits), nil
}

// VerifyTotp reports whether token matches the TOTP for secret within the
// ±window time steps. Comparison is constant-time on equal-length strings.
func VerifyTotp(secretBase32, token string, window, stepSeconds, digits int, now time.Time) bool {
	if window < 0 || window > 4 {
		return false
	}
	tok := strings.ReplaceAll(strings.TrimSpace(token), " ", "")
	if len(tok) < 6 || len(tok) > 8 {
		return false
	}
	for _, c := range tok {
		if c < '0' || c > '9' {
			return false
		}
	}
	for i := -window; i <= window; i++ {
		expected, err := TOTP(secretBase32, now.Add(time.Duration(i)*time.Duration(stepSeconds)*time.Second), stepSeconds, digits)
		if err != nil {
			return false
		}
		if len(expected) == len(tok) && subtle.ConstantTimeCompare([]byte(expected), []byte(tok)) == 1 {
			return true
		}
	}
	return false
}

// BuildOtpauthURL builds a `otpauth://totp/...` provisioning URL identical to
// the Node buildOtpauthUrl (algorithm SHA1, digits, period params).
func BuildOtpauthURL(issuer, accountName, secretBase32 string, digits, period int) (string, error) {
	iss := strings.TrimSpace(issuer)
	acc := strings.TrimSpace(accountName)
	if iss == "" || acc == "" {
		return "", errors.New("buildOtpauthUrl: issuer and accountName are required")
	}
	// Node uses URLSearchParams (insertion order preserved, space -> '+') for
	// the query and encodeURIComponent (space -> '%20') for the label.
	label := encodeURIComponent(iss + ":" + acc)
	query := url.Values{}
	query.Set("secret", strings.TrimSpace(secretBase32))
	query.Set("issuer", iss)
	query.Set("algorithm", "SHA1")
	query.Set("digits", fmt.Sprintf("%d", digits))
	query.Set("period", fmt.Sprintf("%d", period))
	return "otpauth://totp/" + label + "?" + query.Encode(), nil
}

// encodeURIComponent mirrors JavaScript's encodeURIComponent for the subset of
// characters relevant to otpauth labels: it percent-encodes everything except
// `A-Z a-z 0-9 - _ . ! ~ * ' ( )`.
func encodeURIComponent(s string) string {
	const unreserved = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"
	var b strings.Builder
	for _, c := range []byte(s) {
		if strings.ContainsRune(unreserved, rune(c)) {
			b.WriteByte(c)
		} else {
			b.WriteString(fmt.Sprintf("%%%02X", c))
		}
	}
	return b.String()
}