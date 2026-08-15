package mfatotp

import (
	"testing"
	"time"
)

// Fixed time 2020-07-09T12:00:00Z (1594320000 Unix).
var nodeFixedTime = time.Unix(1594320000, 0).UTC()

func TestTOTPNodeVector(t *testing.T) {
	const secret = "JBSWY3DPEHPK3PXP"
	cases := []struct {
		offset time.Duration
		want   string
	}{
		{0, "863420"},
		{-30 * time.Second, "478041"},
		{30 * time.Second, "074366"},
	}
	for _, tc := range cases {
		got, err := TOTP(secret, nodeFixedTime.Add(tc.offset), 30, 6)
		if err != nil {
			t.Fatalf("TOTP: %v", err)
		}
		if got != tc.want {
			t.Errorf("TOTP(offset %v) = %q, want %q", tc.offset, got, tc.want)
		}
	}
}

func TestVerifyTotpWindow(t *testing.T) {
	const secret = "JBSWY3DPEHPK3PXP"
	cur, _ := TOTP(secret, nodeFixedTime, 30, 6)
	if !VerifyTotp(secret, cur, 1, 30, 6, nodeFixedTime) {
		t.Error("valid current code rejected")
	}
	prev, _ := TOTP(secret, nodeFixedTime.Add(-30*time.Second), 30, 6)
	if !VerifyTotp(secret, prev, 1, 30, 6, nodeFixedTime) {
		t.Error("valid previous-window code rejected")
	}
	if VerifyTotp(secret, "000000", 1, 30, 6, nodeFixedTime) {
		t.Error("invalid code accepted")
	}
	if VerifyTotp(secret, "abcdef", 1, 30, 6, nodeFixedTime) {
		t.Error("non-digit code accepted")
	}
	if VerifyTotp(secret, "123", 1, 30, 6, nodeFixedTime) {
		t.Error("short code accepted")
	}
	// whitespace normalization matches Node normalizeToken
	if !VerifyTotp(secret, "  "+cur+"  ", 1, 30, 6, nodeFixedTime) {
		t.Error("whitespace-normalized code rejected")
	}
}

func TestBuildOtpauthURLNodeVector(t *testing.T) {
	got, err := BuildOtpauthURL("Earflow Artists", "user@earflow.ru", "JBSWY3DPEHPK3PXP", 6, 30)
	if err != nil {
		t.Fatal(err)
	}
	want := "otpauth://totp/Earflow%20Artists%3Auser%40earflow.ru?algorithm=SHA1&digits=6&issuer=Earflow+Artists&period=30&secret=JBSWY3DPEHPK3PXP"
	if got != want {
		t.Errorf("otpauth url mismatch:\n got %q\nwant %q", got, want)
	}
}

func TestGenerateSecretBase32(t *testing.T) {
	for _, n := range []int{16, 20, 32, 64} {
		s, err := GenerateSecretBase32(n)
		if err != nil {
			t.Fatalf("GenerateSecretBase32(%d): %v", n, err)
		}
		// 8 base32 chars per 5 bytes, no padding.
		wantLen := (n*8 + 4) / 5
		if len(s) != wantLen {
			t.Errorf("GenerateSecretBase32(%d) len = %d, want %d", n, len(s), wantLen)
		}
		// secrets must be usable in VerifyTotp
		code, err := TOTP(s, time.Now(), 30, 6)
		if err != nil {
			t.Errorf("generated secret not usable: %v", err)
		}
		if !VerifyTotp(s, code, 1, 30, 6, time.Now()) {
			t.Error("generated secret failed round-trip")
		}
	}
	if _, err := GenerateSecretBase32(8); err == nil {
		t.Error("GenerateSecretBase32(8) should fail")
	}
}

func TestBase32RoundTrip(t *testing.T) {
	s, _ := GenerateSecretBase32(20)
	dec, err := decodeBase32(s)
	if err != nil {
		t.Fatal(err)
	}
	if encodeBase32(dec) != s {
		t.Error("base32 round-trip mismatch")
	}
}