package auth

import (
	"net/url"
	"testing"
)

// Contract cases mirrored in frontend/src/auth/__tests__/authDeviceCrypto.test.js
// (PoP canonicalization matrix — keep in sync when changing buildCanonicalProofString).
func TestCanonicalProofString_Matrix(t *testing.T) {
	cases := []struct {
		name    string
		method  string
		path    string
		query   url.Values
		ts      string
		nonce   string
		sidHash string
		want    string
	}{
		{
			name: "profile simple", method: "GET", path: "/api/profile",
			ts: "1710000000", nonce: "nonce-abc", sidHash: "sidhash-xyz",
			want: "v1\nGET\n/api/profile\n\n1710000000\nnonce-abc\nsidhash-xyz",
		},
		{
			name: "profile sorted query", method: "GET", path: "/api/profile",
			query: url.Values{"z": []string{"1"}, "a": []string{"2"}},
			ts: "1710000000", nonce: "nonce-abc", sidHash: "sidhash-xyz",
			want: "v1\nGET\n/api/profile\na=2&z=1\n1710000000\nnonce-abc\nsidhash-xyz",
		},
		{
			name: "artist decoded path with dollar and space", method: "GET", path: "/api/artists/A$AP Rocky/meta",
			ts: "1710000000", nonce: "nonce-artist", sidHash: "sidhash-xyz",
			want: "v1\nGET\n/api/artists/A$AP Rocky/meta\n\n1710000000\nnonce-artist\nsidhash-xyz",
		},
		{
			name: "artist decoded path charli", method: "GET", path: "/api/artists/Charli XCX/meta",
			ts: "1710000000", nonce: "nonce-charli", sidHash: "sidhash-xyz",
			want: "v1\nGET\n/api/artists/Charli XCX/meta\n\n1710000000\nnonce-charli\nsidhash-xyz",
		},
		{
			name: "artist tracks with query", method: "GET", path: "/api/artists/Charli XCX/tracks",
			query: url.Values{"limit": []string{"200"}, "offset": []string{"0"}},
			ts: "1710000000", nonce: "nonce-tracks", sidHash: "sidhash-xyz",
			want: "v1\nGET\n/api/artists/Charli XCX/tracks\nlimit=200&offset=0\n1710000000\nnonce-tracks\nsidhash-xyz",
		},
		{
			name: "unicode artist name", method: "GET", path: "/api/artists/Артём/meta",
			ts: "1710000000", nonce: "nonce-unicode", sidHash: "sidhash-xyz",
			want: "v1\nGET\n/api/artists/Артём/meta\n\n1710000000\nnonce-unicode\nsidhash-xyz",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := buildCanonicalProofString(tc.method, tc.path, tc.query, tc.ts, tc.nonce, tc.sidHash)
			if got != tc.want {
				t.Fatalf("canonical mismatch\nwant:\n%q\ngot:\n%q", tc.want, got)
			}
		})
	}
}
