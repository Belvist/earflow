package auth

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/earflow/music-platform/go-api-gateway/internal/config"
)

func TestCopyUpstreamErrorPreservesStableCode(t *testing.T) {
	upstream := httptest.NewRecorder()
	upstream.Header().Set(hdrContentType, ctJSON)
	upstream.WriteHeader(http.StatusUnauthorized)
	_, _ = upstream.WriteString(`{"error":"Неверный email или пароль","code":"INVALID_CREDENTIALS"}`)

	resp := upstream.Result()
	defer resp.Body.Close()

	w := httptest.NewRecorder()
	copyUpstreamError(w, resp)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
	var body errorResponse
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if body.Code != "INVALID_CREDENTIALS" {
		t.Fatalf("code = %q, want INVALID_CREDENTIALS", body.Code)
	}
	if body.Error != "Неверный email или пароль" {
		t.Fatalf("error = %q", body.Error)
	}
}

func TestCopyUpstreamErrorPreservesLoginRateLimitedRetryAfter(t *testing.T) {
	upstream := httptest.NewRecorder()
	upstream.Header().Set(hdrContentType, ctJSON)
	upstream.WriteHeader(http.StatusTooManyRequests)
	_, _ = upstream.WriteString(`{"error":"Слишком много неудачных попыток","code":"LOGIN_RATE_LIMITED","retryAfterSeconds":60}`)

	resp := upstream.Result()
	defer resp.Body.Close()

	w := httptest.NewRecorder()
	copyUpstreamError(w, resp)

	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusTooManyRequests)
	}
	raw := w.Body.Bytes()
	if !strings.Contains(string(raw), `"LOGIN_RATE_LIMITED"`) {
		t.Fatalf("body missing LOGIN_RATE_LIMITED: %s", raw)
	}
	if !strings.Contains(string(raw), `"retryAfterSeconds":60`) {
		t.Fatalf("body missing retryAfterSeconds: %s", raw)
	}
}

func TestHandleEmailLoginPassthroughInvalidCredentials(t *testing.T) {
	authServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set(hdrContentType, ctJSON)
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"error":"Неверный email или пароль","code":"INVALID_CREDENTIALS"}`)
	}))
	defer authServer.Close()

	manager := newAuthExchangeTestManager(authServer.URL)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/email/login", strings.NewReader(`{"email":"a@b.c","password":"wrong"}`))
	req.Header.Set("Origin", "https://earflow.ru")
	req.Header.Set(hdrContentType, ctJSON)
	w := httptest.NewRecorder()

	manager.handleEmailLogin().ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
	var body errorResponse
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if body.Code != "INVALID_CREDENTIALS" {
		t.Fatalf("code = %q, want INVALID_CREDENTIALS", body.Code)
	}
}

func TestHandleEmailLoginPassthroughLoginRateLimited(t *testing.T) {
	authServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set(hdrContentType, ctJSON)
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = io.WriteString(w, `{"error":"Слишком много неудачных попыток","code":"LOGIN_RATE_LIMITED","retryAfterSeconds":90}`)
	}))
	defer authServer.Close()

	manager := newAuthExchangeTestManager(authServer.URL)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/email/login", strings.NewReader(`{"email":"a@b.c","password":"x"}`))
	req.Header.Set("Origin", "https://earflow.ru")
	req.Header.Set(hdrContentType, ctJSON)
	w := httptest.NewRecorder()

	manager.handleEmailLogin().ServeHTTP(w, req)

	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusTooManyRequests)
	}
	raw := w.Body.Bytes()
	if !strings.Contains(string(raw), `"LOGIN_RATE_LIMITED"`) {
		t.Fatalf("body missing LOGIN_RATE_LIMITED: %s", raw)
	}
}

func TestHandleEmailLoginPassthroughMfaRequired(t *testing.T) {
	authServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set(hdrContentType, ctJSON)
		w.WriteHeader(http.StatusForbidden)
		_, _ = io.WriteString(w, `{"error":"MFA_REQUIRED","code":"MFA_REQUIRED"}`)
	}))
	defer authServer.Close()

	manager := newAuthExchangeTestManager(authServer.URL)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/email/login", strings.NewReader(`{"email":"a@b.c","password":"ok"}`))
	req.Header.Set("Origin", "https://earflow.ru")
	req.Header.Set(hdrContentType, ctJSON)
	w := httptest.NewRecorder()

	manager.handleEmailLogin().ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusForbidden)
	}
	var body errorResponse
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if body.Code != "MFA_REQUIRED" {
		t.Fatalf("code = %q, want MFA_REQUIRED", body.Code)
	}
}

func TestHandleEmailRegisterPassthroughEmailAlreadyRegistered(t *testing.T) {
	authServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set(hdrContentType, ctJSON)
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"error":"Email уже зарегистрирован","code":"EMAIL_ALREADY_REGISTERED"}`)
	}))
	defer authServer.Close()

	manager := newAuthExchangeTestManager(authServer.URL)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/email/register", strings.NewReader(`{"email":"a@b.c","password":"Secret123","username":"ab"}`))
	req.Header.Set("Origin", "https://earflow.ru")
	req.Header.Set(hdrContentType, ctJSON)
	w := httptest.NewRecorder()

	manager.handleEmailRegister().ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusBadRequest)
	}
	var body errorResponse
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if body.Code != "EMAIL_ALREADY_REGISTERED" {
		t.Fatalf("code = %q, want EMAIL_ALREADY_REGISTERED", body.Code)
	}
	if body.Error != "Email уже зарегистрирован" {
		t.Fatalf("error = %q", body.Error)
	}
}

func TestHandleEmailRegisterPassthroughValidationError(t *testing.T) {
	authServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set(hdrContentType, ctJSON)
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"error":"Email и пароль обязательны","code":"VALIDATION_ERROR"}`)
	}))
	defer authServer.Close()

	manager := newAuthExchangeTestManager(authServer.URL)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/email/register", strings.NewReader(`{}`))
	req.Header.Set("Origin", "https://earflow.ru")
	req.Header.Set(hdrContentType, ctJSON)
	w := httptest.NewRecorder()

	manager.handleEmailRegister().ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusBadRequest)
	}
	var body errorResponse
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if body.Code != "VALIDATION_ERROR" {
		t.Fatalf("code = %q, want VALIDATION_ERROR", body.Code)
	}
}

func TestHandleEmailLoginPassthroughBare401WithoutCodeIsUpstreamGap(t *testing.T) {
	authServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set(hdrContentType, ctJSON)
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"error":"Неверный email или пароль"}`)
	}))
	defer authServer.Close()

	manager := newAuthExchangeTestManager(authServer.URL)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/email/login", strings.NewReader(`{"email":"a@b.c","password":"x"}`))
	req.Header.Set("Origin", "https://earflow.ru")
	req.Header.Set(hdrContentType, ctJSON)
	w := httptest.NewRecorder()

	manager.handleEmailLogin().ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, hasCode := body["code"]; hasCode {
		t.Fatalf("expected no code field for upstream gap body, got %v", body)
	}
	if body["error"] != "Неверный email или пароль" {
		t.Fatalf("error passthrough = %v", body["error"])
	}
}

func TestCopyUpstreamErrorDoesNotDowngrade429To401(t *testing.T) {
	upstream := httptest.NewRecorder()
	upstream.Header().Set(hdrContentType, ctJSON)
	upstream.WriteHeader(http.StatusTooManyRequests)
	_, _ = upstream.WriteString(`{"error":"lockout","code":"LOGIN_RATE_LIMITED","retryAfterSeconds":30}`)

	resp := upstream.Result()
	defer resp.Body.Close()

	w := httptest.NewRecorder()
	copyUpstreamError(w, resp)

	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want %d (must not mask lockout as 401)", w.Code, http.StatusTooManyRequests)
	}
}

func newAuthExchangeTestManager(authBaseURL string) *SessionManager {
	return &SessionManager{
		authBaseURL:    authBaseURL,
		allowedOrigins: map[string]struct{}{"https://earflow.ru": {}},
		cookie:         config.CookieConfig{Domain: ".earflow.ru", SameSite: "none", Secure: true},
		cookieNames:    testMainCookieNames(),
	}
}
