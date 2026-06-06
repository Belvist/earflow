package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

const sessionCipherPrefix = "v1:"

var (
	errSessionCipherInvalidKey = errors.New("invalid SESSION_ENCRYPTION_KEY")
	errSessionCipherFailed     = errors.New("session encryption failed")
)

type sessionCipher struct {
	aead cipher.AEAD
}

func newSessionCipherFromEnv() (*sessionCipher, error) {
	raw := strings.TrimSpace(os.Getenv("SESSION_ENCRYPTION_KEY"))
	if raw == "" {
		return nil, nil
	}
	key := decodeSessionKey(raw)
	if len(key) != 32 {
		return nil, fmt.Errorf("%w: decoded key must be 32 bytes, got %d", errSessionCipherInvalidKey, len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errSessionCipherInvalidKey, err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errSessionCipherInvalidKey, err)
	}
	return &sessionCipher{aead: aead}, nil
}

func decodeSessionKey(raw string) []byte {
	s := strings.TrimSpace(raw)
	if s == "" {
		return nil
	}

	if b, err := hex.DecodeString(s); err == nil {
		return b
	}

	decoders := []func(string) ([]byte, error){
		base64.RawStdEncoding.DecodeString,
		base64.StdEncoding.DecodeString,
		base64.RawURLEncoding.DecodeString,
		base64.URLEncoding.DecodeString,
	}
	for _, dec := range decoders {
		b, err := dec(s)
		if err == nil {
			return b
		}
	}
	return nil
}

func (c *sessionCipher) encryptJSON(plaintext []byte) (string, bool) {
	if c == nil || c.aead == nil {
		return "", false
	}
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", false
	}
	ct := c.aead.Seal(nil, nonce, plaintext, nil)
	buf := make([]byte, 0, len(nonce)+len(ct))
	buf = append(buf, nonce...)
	buf = append(buf, ct...)
	enc := base64.RawURLEncoding.EncodeToString(buf)
	return sessionCipherPrefix + enc, true
}

func (c *sessionCipher) decryptJSON(raw string) ([]byte, bool) {
	if c == nil || c.aead == nil {
		return nil, false
	}
	if !strings.HasPrefix(raw, sessionCipherPrefix) {
		return nil, false
	}
	payload := strings.TrimSpace(strings.TrimPrefix(raw, sessionCipherPrefix))
	if payload == "" {
		return nil, false
	}
	buf, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return nil, false
	}
	ns := c.aead.NonceSize()
	if len(buf) <= ns {
		return nil, false
	}
	nonce := buf[:ns]
	ct := buf[ns:]
	pt, err := c.aead.Open(nil, nonce, ct, nil)
	if err != nil {
		return nil, false
	}
	return pt, true
}
