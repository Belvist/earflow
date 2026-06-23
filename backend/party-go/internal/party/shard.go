package party

import (
	"crypto/sha256"
	"encoding/binary"
	"strings"
)

// ShardForParty matches TypeScript shardForParty
func ShardForParty(partyID string, shardCount int) int {
	if shardCount <= 0 {
		return 0
	}
	id := strings.TrimSpace(partyID)
	if id == "" {
		return 0
	}
	h := sha256.Sum256([]byte(id))
	v := binary.BigEndian.Uint32(h[:4])
	return int(v % uint32(shardCount))
}
