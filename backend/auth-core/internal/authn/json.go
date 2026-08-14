package authn

import (
	"encoding/json"

	"github.com/earflow/music-platform/auth-core/internal/cryptoutil"
)

func marshalJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}

func unmarshalJSON(data []byte, v any) error {
	return json.Unmarshal(data, v)
}

// encryptJSON wraps cryptoutil.EncryptPayload (Node encryptData) on raw JSON.
func encryptJSON(encKey []byte, saltHex string, plaintext []byte, iterations, keyLength int) (*cryptoutil.EncryptedPayload, error) {
	return cryptoutil.EncryptPayload(encKey, saltHex, plaintext, iterations, keyLength)
}

// decryptPayloadFields wraps cryptoutil.DecryptPayload for a manually parsed
// encryptData payload (email_encrypted records).
func decryptPayloadFields(encKey []byte, saltHex string, version int, encrypted, iv, tag string, iter, legacyIter, keyLen int) ([]byte, error) {
	return cryptoutil.DecryptPayload(encKey, saltHex, cryptoutil.EncryptedPayload{
		V:         version,
		Encrypted: encrypted,
		IV:        iv,
		AuthTag:   tag,
	}, iter, legacyIter, keyLen)
}
