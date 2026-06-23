package cryptoutil

import (
	"crypto/sha512"
	"crypto/subtle"
	"encoding/hex"

	"golang.org/x/crypto/pbkdf2"
)

// HashPassword produces a hex-encoded PBKDF2-SHA512 hash compatible with the
// Node auth-service implementation: pbkdf2Sync(password, salt, iterations, 64, 'sha512').
//
// `salt` is a hex-decoded string the same way Node stores it (salt column is a
// hex string, passed to pbkdf2 as-is, i.e. as its utf-8 bytes — so we must
// pass the salt bytes as utf-8 of the hex string, matching Node behavior).
func HashPassword(password string, saltHex string, iterations, keyLength int) string {
	derived := pbkdf2.Key(
		[]byte(password),
		[]byte(saltHex),
		iterations,
		keyLength,
		sha512.New,
	)
	return hex.EncodeToString(derived)
}

// ConstantTimeHexEquals compares two hex-encoded strings in constant time.
// Returns false if lengths differ.
func ConstantTimeHexEquals(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
