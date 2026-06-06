package stateserver

import "testing"

func TestInviteCodeCandidates(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want []string
	}{
		{
			name: "hyphenated uppercase",
			raw:  "8JEZ-6RTR",
			want: []string{"8JEZ-6RTR", "8JEZ6RTR"},
		},
		{
			name: "compact lowercase",
			raw:  "8jez6rtr",
			want: []string{"8jez6rtr", "8JEZ6RTR", "8JEZ-6RTR"},
		},
		{
			name: "spaces around hyphen",
			raw:  " 8jez - 6rtr ",
			want: []string{"8jez - 6rtr", "8JEZ - 6RTR", "8JEZ6RTR", "8JEZ-6RTR"},
		},
		{
			name: "unicode en dash between groups",
			raw:  "8JEZ\u20136RTR",
			want: []string{"8JEZ-6RTR", "8JEZ6RTR", "8JEZ-6RTR"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := inviteCodeCandidates(tt.raw)
			for _, want := range tt.want {
				if !containsString(got, want) {
					t.Fatalf("expected %q in %v", want, got)
				}
			}
		})
	}
}

func TestInviteCodeCandidatesRejectsShortInput(t *testing.T) {
	if got := inviteCodeCandidates("abc-12"); got != nil {
		t.Fatalf("expected nil candidates, got %v", got)
	}
}

func containsString(values []string, needle string) bool {
	for _, v := range values {
		if v == needle {
			return true
		}
	}
	return false
}
