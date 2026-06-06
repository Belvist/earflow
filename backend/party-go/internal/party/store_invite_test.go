package party

import "testing"

func TestInviteCodeIndexFormsIncludesHyphenatedAndCompact(t *testing.T) {
	got := inviteCodeIndexForms("8jez-6rtr")
	want := []string{"8JEZ-6RTR", "8JEZ6RTR"}
	for _, v := range want {
		if !hasString(got, v) {
			t.Fatalf("inviteCodeIndexForms missing %q in %v", v, got)
		}
	}
}

func TestNormalizeInviteKeySuffixCanonicalizesCompactCode(t *testing.T) {
	if got := normalizeInviteKeySuffix("8jez6rtr"); got != "8JEZ-6RTR" {
		t.Fatalf("normalizeInviteKeySuffix = %q, want 8JEZ-6RTR", got)
	}
}

func hasString(values []string, needle string) bool {
	for _, v := range values {
		if v == needle {
			return true
		}
	}
	return false
}
