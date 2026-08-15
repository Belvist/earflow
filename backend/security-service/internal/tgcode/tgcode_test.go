package tgcode

import (
	"context"
	"testing"
)

func TestGenerateCodeLength(t *testing.T) {
	for _, n := range []int{6, 8, 12} {
		code, err := GenerateCode(n)
		if err != nil {
			t.Fatal(err)
		}
		if len(code) != n {
			t.Fatalf("len=%d want %d", len(code), n)
		}
		for _, c := range code {
			if c < '0' || c > '9' {
				t.Fatalf("non-digit in code %q", code)
			}
		}
	}
}

func TestGenerateCodeDefaultLength(t *testing.T) {
	code, err := GenerateCode(0)
	if err != nil {
		t.Fatal(err)
	}
	if len(code) != 6 {
		t.Fatalf("len=%d want 6", len(code))
	}
}

func TestGenerateCodeDistinct(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 100; i++ {
		code, _ := GenerateCode(6)
		if seen[code] {
			continue
		}
		seen[code] = true
	}
	if len(seen) < 90 {
		t.Fatalf("only %d distinct codes in 100 draws", len(seen))
	}
}

func TestClientEnabled(t *testing.T) {
	if NewClient("").Enabled() {
		t.Fatal("empty token must be disabled")
	}
	if !NewClient("123:ABC").Enabled() {
		t.Fatal("non-empty token must be enabled")
	}
	var nilClient *Client
	if nilClient.Enabled() {
		t.Fatal("nil client should be disabled")
	}
}

func TestDeleteMessageDisabledIsNoop(t *testing.T) {
	c := NewClient("")
	if err := c.DeleteMessage(context.Background(), 123, 1); err != nil {
		t.Fatalf("delete on disabled client must not error: %v", err)
	}
}

func TestSendCodeDisabled(t *testing.T) {
	c := NewClient("")
	if _, err := c.SendCode(context.Background(), 123, "code"); err != ErrDisabled {
		t.Fatalf("err=%v want ErrDisabled", err)
	}
}
