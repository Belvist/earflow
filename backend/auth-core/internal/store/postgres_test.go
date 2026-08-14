package store

import (
	"strings"
	"testing"
)

// Guard против регресса "SELECT без password_hash": LoginEmail зависит от
// password_hash + salt, но authUserSelect долгое время их не выбирал — поле
// PasswordHash всегда был nil, и каждый логин падал с INVALID_CREDENTIALS
// (обнаружено при e2e smoke на VPS 2026-08-14).
func TestAuthUserSelectIncludesLoginCredentialColumns(t *testing.T) {
	for _, col := range []string{"password_hash", "salt", "email_hash"} {
		if !strings.Contains(authUserSelect, col) {
			t.Fatalf("authUserSelect missing column %q — login password verification would always fail", col)
		}
	}
}
