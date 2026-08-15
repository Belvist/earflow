package cryptoutil

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha512"
	"encoding/hex"
	"errors"

	"golang.org/x/crypto/pbkdf2"
)

// EncryptedPayload mirrors the wire format produced by Node:
// `{ v: 2, encrypted: <hex>, iv: <hex>, authTag: <hex> }`.
type EncryptedPayload struct {
	V         int    `json:"v"`
	Encrypted string `json:"encrypted"`
	IV        string `json:"iv"`
	AuthTag   string `json:"authTag"`
}

// DeriveAESKey derives the AES-256 key using the same parameters as the Node
// auth-service: pbkdf2(encryptionKeyBuffer, userSalt, iterations, 32, 'sha512').
func DeriveAESKey(encryptionKey []byte, userSaltHex string, iterations, keyLength int) []byte {
	return pbkdf2.Key(encryptionKey, []byte(userSaltHex), iterations, keyLength, sha512.New)
}

// EncryptPayload produces a payload byte-compatible with Node encryptData:
// AES-256-GCM, 16-byte IV, 16-byte auth tag, hex ciphertext, version 2.
func EncryptPayload(
	encryptionKey []byte,
	userSaltHex string,
	plaintext []byte,
	iterations, keyLength int,
) (*EncryptedPayload, error) {
	if encryptionKey == nil {
		return nil, errors.New("encryption key missing")
	}
	key := DeriveAESKey(encryptionKey, userSaltHex, iterations, keyLength)

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCMWithNonceSize(block, 16)
	if err != nil {
		return nil, err
	}

	iv := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(iv); err != nil {
		return nil, err
	}

	sealed := gcm.Seal(nil, iv, plaintext, nil)
	tagStart := len(sealed) - gcm.Overhead()
	ct := sealed[:tagStart]
	tag := sealed[tagStart:]

	return &EncryptedPayload{
		V:         2,
		Encrypted: hex.EncodeToString(ct),
		IV:        hex.EncodeToString(iv),
		AuthTag:   hex.EncodeToString(tag),
	}, nil
}

// DecryptPayload decrypts a payload produced by Node auth-service.
// Uses version-specific PBKDF2 iterations: v==2 -> pbkdfIterations, else legacy.
func DecryptPayload(
	encryptionKey []byte,
	userSaltHex string,
	payload EncryptedPayload,
	pbkdfIterations, pbkdfIterationsLegacy, keyLength int,
) ([]byte, error) {
	if encryptionKey == nil {
		return nil, errors.New("encryption key missing")
	}
	iterations := pbkdfIterationsLegacy
	if payload.V == 2 {
		iterations = pbkdfIterations
	}

	key := DeriveAESKey(encryptionKey, userSaltHex, iterations, keyLength)

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	iv, err := hex.DecodeString(payload.IV)
	if err != nil {
		return nil, err
	}
	if len(iv) != gcm.NonceSize() && len(iv) != 16 {
		return nil, errors.New("iv size mismatch")
	}

	ct, err := hex.DecodeString(payload.Encrypted)
	if err != nil {
		return nil, err
	}
	tag, err := hex.DecodeString(payload.AuthTag)
	if err != nil {
		return nil, err
	}

	// Go GCM implementation expects ciphertext || tag; Node splits them.
	sealed := make([]byte, 0, len(ct)+len(tag))
	sealed = append(sealed, ct...)
	sealed = append(sealed, tag...)

	// Use the same IV length as Node (16 bytes). Standard GCM default is 12 bytes;
	// we need NewGCMWithNonceSize to match Node's 16-byte IV.
	gcm16, err := cipher.NewGCMWithNonceSize(block, len(iv))
	if err != nil {
		return nil, err
	}
	plaintext, err := gcm16.Open(nil, iv, sealed, nil)
	if err != nil {
		return nil, err
	}
	return plaintext, nil
}
