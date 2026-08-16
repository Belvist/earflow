package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/earflow/music-platform/security-service/internal/authz"
	"github.com/earflow/music-platform/security-service/internal/store"
)

// stepUpUserLookup stubs user lookups for the step-up gate tests.
type stepUpUserLookup struct{ mfaEnabled bool }

func (l stepUpUserLookup) GetUserByID(ctx context.Context, userID int64) (*store.User, error) {
	if userID != 7 {
		return nil, store.ErrUserNotFound
	}
	return &store.User{ID: userID, MFAEnabled: l.mfaEnabled}, nil
}

const freshSID = "sid_12345678901234567890"

// seedSession writes a refresh session with the given createdAt age.
func seedSession(t *testing.T, d Deps, age time.Duration) {
	t.Helper()
	created := time.Now().UTC().Add(-age)
	if err := d.Redis.Client().Set(context.Background(), store.SIDKey(freshSID), "jti_seed", 2*time.Hour).Err(); err != nil {
		t.Fatal(err)
	}
	meta, err := json.Marshal(map[string]interface{}{
		"userId":     7,
		"createdAt":  created.Format(time.RFC3339),
		"lastSeenAt": time.Now().UTC().Format(time.RFC3339),
		"ip":         "1.2.3.4",
		"ua":         "Chrome on Mac",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := d.Redis.Client().Set(context.Background(), store.SessionMetaKey(freshSID), string(meta), 2*time.Hour).Err(); err != nil {
		t.Fatal(err)
	}
}

func stepUpPrincipal(t *testing.T, d Deps) authz.Principal {
	t.Helper()
	r := authedRequest(t, http.MethodPost, "/api/auth/sessions/revoke-others", 7, freshSID, nil)
	principal, ok := authz.FromContext(r.Context())
	if !ok {
		t.Fatal("no principal in context")
	}
	return principal
}

func TestRevokeOthersWithoutMfaSkipsStepUpGate(t *testing.T) {
	d := testDeps(t)
	d.Users = stepUpUserLookup{mfaEnabled: false}
	seedSession(t, d, time.Minute) // fresh session
	w := httptest.NewRecorder()
	r := authedRequest(t, http.MethodPost, "/api/auth/sessions/revoke-others", 7, freshSID, nil)
	principal, ok := authz.FromContext(r.Context())
	if !ok {
		t.Fatal("no principal")
	}
	if !d.requireStepUpForSensitiveSessionAction(w, r, principal, true) {
		t.Fatalf("gate blocked mass revoke for user without MFA: %d %s", w.Code, w.Body.String())
	}
	if w.Code != http.StatusOK {
		t.Fatalf("gate wrote unexpected response: %d %s", w.Code, w.Body.String())
	}
}

func TestRevokeOthersMfaFreshSessionRequiresStepUp(t *testing.T) {
	d := testDeps(t)
	d.Users = stepUpUserLookup{mfaEnabled: true}
	seedSession(t, d, time.Minute) // fresh session, no step-up yet
	w := httptest.NewRecorder()
	r := authedRequest(t, http.MethodPost, "/api/auth/sessions/revoke-others", 7, freshSID, nil)
	principal, ok := authz.FromContext(r.Context())
	if !ok {
		t.Fatal("no principal")
	}
	if d.requireStepUpForSensitiveSessionAction(w, r, principal, true) {
		t.Fatalf("gate allowed mass revoke on fresh MFA session without step-up")
	}
	if w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "FRESH_LOGIN_REQUIRED") {
		t.Fatalf("expected FRESH_LOGIN_REQUIRED, got %d %s", w.Code, w.Body.String())
	}
}

func TestRevokeOthersMfaOldSessionRequiresStepUp(t *testing.T) {
	d := testDeps(t)
	d.Users = stepUpUserLookup{mfaEnabled: true}
	seedSession(t, d, 48*time.Hour) // old session, no step-up
	w := httptest.NewRecorder()
	r := authedRequest(t, http.MethodPost, "/api/auth/sessions/revoke-others", 7, freshSID, nil)
	principal, ok := authz.FromContext(r.Context())
	if !ok {
		t.Fatal("no principal")
	}
	if d.requireStepUpForSensitiveSessionAction(w, r, principal, true) {
		t.Fatalf("gate allowed mass revoke on MFA session without step-up")
	}
	if w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "MFA_STEP_UP_REQUIRED") {
		t.Fatalf("expected MFA_STEP_UP_REQUIRED, got %d %s", w.Code, w.Body.String())
	}
}

func TestRevokeOthersMfaWithStepUpPasses(t *testing.T) {
	d := testDeps(t)
	d.Users = stepUpUserLookup{mfaEnabled: true}
	seedSession(t, d, 48*time.Hour)
	principal := stepUpPrincipal(t, d)
	if err := d.Redis.BumpStepUp(context.Background(), principal.SID, principal.UserID, d.Config.Security.StepUpTTL); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	r := authedRequest(t, http.MethodPost, "/api/auth/sessions/revoke-others", 7, freshSID, nil)
	principal, ok := authz.FromContext(r.Context())
	if !ok {
		t.Fatal("no principal")
	}
	if !d.requireStepUpForSensitiveSessionAction(w, r, principal, true) {
		t.Fatalf("gate blocked mass revoke with active step-up: %d %s", w.Code, w.Body.String())
	}
	if w.Code != http.StatusOK {
		t.Fatalf("gate wrote unexpected response: %d %s", w.Code, w.Body.String())
	}
}