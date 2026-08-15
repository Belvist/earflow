package recoverycodes

import "testing"

func TestConsumeNodeVector(t *testing.T) {
	const salt = "salthex"
	const code = "GANFD27UYK0E"
	h0 := Hash(salt, code)
	if h0 != "52969b4e316c0de3f7fe74f68bd7b49557b160aea840dc97b65ea8beb9a6a0cf" {
		t.Fatalf("Hash mismatch: %s", h0)
	}

	res := Consume(salt, code, []string{h0, "aaaa"})
	if !res.OK {
		t.Fatal("valid code not consumed")
	}
	if len(res.NextHashes) != 1 || res.NextHashes[0] != "aaaa" {
		t.Errorf("nextHashes = %v, want [aaaa]", res.NextHashes)
	}

	bad := Consume(salt, "WRONGCODE", []string{h0})
	if bad.OK {
		t.Error("invalid code consumed")
	}
}

func TestConsumeLowercaseCode(t *testing.T) {
	const salt = "salt1"
	code := "AbCdEfGh123"
	h := Hash(salt, code)
	res := Consume(salt, "abcdefgh123", []string{h})
	if !res.OK {
		t.Error("lowercase provided code should match uppercase hash")
	}
}

func TestConsumeIdempotent(t *testing.T) {
	const salt = "salt2"
	codes, err := Generate(10, 9)
	if err != nil {
		t.Fatal(err)
	}
	hashes, err := HashAll(salt, codes)
	if err != nil {
		t.Fatal(err)
	}
	res := Consume(salt, codes[3], hashes)
	if !res.OK || len(res.NextHashes) != 9 {
		t.Fatalf("first consume: ok=%v len=%d", res.OK, len(res.NextHashes))
	}
	// Reusing the same code must fail (already removed).
	res2 := Consume(salt, codes[3], res.NextHashes)
	if res2.OK {
		t.Error("reused recovery code accepted")
	}
}
