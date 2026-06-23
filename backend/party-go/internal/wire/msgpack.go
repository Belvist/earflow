package wire

import (
	"github.com/vmihailenco/msgpack/v5"
)

func Encode(v any) ([]byte, error)  { return msgpack.Marshal(v) }
func Decode(b []byte, v any) error { return msgpack.Unmarshal(b, v) }
func DecodeAny(b []byte) (any, error) {
	var v any
	err := msgpack.Unmarshal(b, &v)
	return v, err
}

// DecodeMap decodes to map[string]any (used by NATS / WS fanout).
func DecodeMap(b []byte) (map[string]any, error) {
	var m map[string]any
	err := msgpack.Unmarshal(b, &m)
	return m, err
}
