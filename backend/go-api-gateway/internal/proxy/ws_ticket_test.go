package proxy

import "testing"

func TestIsPlausibleWSTicket(t *testing.T) {
	jwt := "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSIsImRldmljZUlkIjoiZDEifQ.c2lnbmF0dXJlLXBsYWNlaG9sZGVy"
	cases := []struct {
		name   string
		ticket string
		want   bool
	}{
		{"legacy jwt", jwt, true},
		{"opaque ws_connect ticket (SEC-005 phase 8)", "0hyAMfQrMOgcrKzrrsHCL9yppT1p8Wi1f7VpKEdDeYA", true},
		{"opaque min length", "abcdefghij1234567890", true},
		{"too short", "abc", false},
		{"empty", "", false},
		{"invalid chars", "abcdefghij1234567890!@#$%^&*()", false},
		{"one dot only", "abcdefghij1234567890.abcdefghij1234567890abcdefghij1234567890", false},
	}
	for _, tc := range cases {
		if got := isPlausibleWSTicket(tc.ticket); got != tc.want {
			t.Errorf("%s: isPlausibleWSTicket(%q) = %v, want %v", tc.name, tc.ticket, got, tc.want)
		}
	}
}
