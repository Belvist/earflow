package wire

import "testing"

func TestEncodeDecodeMap(t *testing.T) {
	b, err := Encode(map[string]any{
		"t":       "reply",
		"partyId": "p1",
		"payload": map[string]any{"ok": true, "doc": map[string]any{"id": "p1", "rev": 1.0}},
	})
	if err != nil {
		t.Fatal(err)
	}
	m, err := DecodeMap(b)
	if err != nil {
		t.Fatal(err)
	}
	if m["t"] != "reply" {
		t.Fatalf("t=%v", m["t"])
	}
}
