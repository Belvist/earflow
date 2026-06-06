package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

type seededSession struct {
	SID        string
	JTI        string
	UserID     int64
	Access     string
	Refresh    string
	UserJSON   string
	DeviceIDs  []string
}

func seedUnifiedSession(t *testing.T, mr *miniredis.Miniredis, secret string, in seededSession) {
	t.Helper()
	sid := in.SID
	jti := in.JTI
	userID := in.UserID
	if in.UserJSON == "" {
		in.UserJSON = fmt.Sprintf(`{"id":%d,"userId":%d}`, userID, userID)
	}
	access := in.Access
	if access == "" {
		access = makeAccessTokenForTest(t, secret, strconv.FormatInt(userID, 10))
	}
	sessJSON := marshalSessionForTest(t, Session{
		AccessToken:  access,
		RefreshToken: in.Refresh,
		User:         json.RawMessage(in.UserJSON),
	})
	mr.Set("mp:sess:"+sid, sessJSON)
	mr.Set(authSIDKey(sid), jti)
	mr.Set(authRefreshKey(jti), fmt.Sprintf(`{"userId":%d,"sid":"%s"}`, userID, sid))
	mr.Set(authSessionMetaKey(sid), fmt.Sprintf(`{"userId":%d,"createdAt":"2026-06-01T00:00:00Z","lastSeenAt":"2026-06-01T00:00:00Z"}`, userID))
	mr.SAdd(authUserSidsKey(userID), sid)
	for _, devID := range in.DeviceIDs {
		rec, _ := json.Marshal(AuthDeviceRecord{
			AuthDeviceID:  devID,
			SID:           sid,
			UserID:        userID,
			PublicKeySPKI: "c3BpLW1vY2s",
			CreatedAt:     "2026-06-01T00:00:00Z",
			LastSeenAt:    "2026-06-01T00:00:00Z",
		})
		mr.Set(authDeviceKey(devID), string(rec))
		mr.SAdd(authSidDevicesKey(sid), devID)
		mr.SAdd(fmt.Sprintf("%s%d", authUserDevicesPrefix, userID), devID)
	}
}

func newContractManager(t *testing.T, mr *miniredis.Miniredis) *SessionManager {
	t.Helper()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	secret := "test-secret-test-secret-test-secret-32"
	return &SessionManager{
		store:                &SessionStore{rdb: redisSessionKV{rdb: rdb}, keyPrefix: "mp:sess:", ttl: time.Hour},
		devices:              NewAuthDeviceStore(rdb),
		rdb:                  rdb,
		gatewaySessionPrefix: "mp:sess:",
		jwtSecret:            secret,
		cookieNames:          testMainCookieNames(),
		sessionTTL:           time.Hour,
		allowedOrigins:       map[string]struct{}{"https://earflow.ru": {}},
		isProduction:         true,
	}
}

func serveProfile(t *testing.T, m *SessionManager, sid string) int {
	t.Helper()
	req := httptestNewRequestWithCookie(http.MethodGet, "/api/profile", sid)
	w := httptest.NewRecorder()
	chain := m.SessionAuthMiddleware()(http.HandlerFunc(m.handleProfile()))
	chain.ServeHTTP(w, req)
	return w.Code
}

func assertSessionKeysAbsent(t *testing.T, mr *miniredis.Miniredis, sid, jti string, userID int64, deviceIDs []string) {
	t.Helper()
	keys := []string{
		authSIDKey(sid),
		authRefreshKey(jti),
		authSessionMetaKey(sid),
		"mp:sess:" + sid,
		authSidDevicesKey(sid),
	}
	for _, k := range keys {
		if mr.Exists(k) {
			t.Fatalf("expected absent: %s", k)
		}
	}
	if userID > 0 {
		if ok, _ := mr.SIsMember(authUserSidsKey(userID), sid); ok {
			t.Fatalf("sid still in auth:user_sids:%d", userID)
		}
	}
	for _, devID := range deviceIDs {
		if mr.Exists(authDeviceKey(devID)) {
			t.Fatalf("expected device absent: %s", devID)
		}
	}
}

func TestContractLoginProfileLogoutOldSidUnauthorized(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	secret := "test-secret-test-secret-test-secret-32"
	sid := "sid_12345678901234567890"
	jti := "jti-contract-logout"
	m := newContractManager(t, mr)
	seedUnifiedSession(t, mr, secret, seededSession{SID: sid, JTI: jti, UserID: 7, Refresh: "refresh-7", DeviceIDs: []string{"adev_12345678901234567890"}})

	if code := serveProfile(t, m, sid); code != http.StatusOK {
		t.Fatalf("profile before logout = %d, want 200", code)
	}

	logoutRec := httptest.NewRecorder()
	m.handleLogout()(logoutRec, httptestNewRequestWithCookie(http.MethodPost, "/api/auth/logout", sid))
	if logoutRec.Code != http.StatusNoContent {
		t.Fatalf("logout = %d", logoutRec.Code)
	}

	assertSessionKeysAbsent(t, mr, sid, jti, 7, []string{"adev_12345678901234567890"})

	if code := serveProfile(t, m, sid); code != http.StatusUnauthorized {
		t.Fatalf("profile with stale mp_sid = %d, want 401", code)
	}
}

func TestContractRevokeOthersLeavesCurrentSession(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	secret := "test-secret-test-secret-test-secret-32"
	sidKeep := "sid_aaaaaaaaaaaaaaaaaaaa"
	sidOther := "sid_bbbbbbbbbbbbbbbbbbbb"
	jtiKeep := "jti-keep"
	jtiOther := "jti-other"
	userID := int64(99)
	m := newContractManager(t, mr)
	seedUnifiedSession(t, mr, secret, seededSession{SID: sidKeep, JTI: jtiKeep, UserID: userID, Refresh: "r-keep"})
	seedUnifiedSession(t, mr, secret, seededSession{SID: sidOther, JTI: jtiOther, UserID: userID, Refresh: "r-other"})

	if err := m.RevokeSessionFull(context.Background(), sidOther, userID, jtiOther); err != nil {
		t.Fatal(err)
	}

	assertSessionKeysAbsent(t, mr, sidOther, jtiOther, userID, nil)
	if code := serveProfile(t, m, sidOther); code != http.StatusUnauthorized {
		t.Fatalf("other sid profile = %d, want 401", code)
	}
	if code := serveProfile(t, m, sidKeep); code != http.StatusOK {
		t.Fatalf("keep sid profile = %d, want 200", code)
	}
	if !mr.Exists("mp:sess:" + sidKeep) {
		t.Fatal("keep mp:sess should remain")
	}
}

func TestContractPasswordChangePolicyRevokeAllExceptCurrent(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	secret := "test-secret-test-secret-test-secret-32"
	sidCurrent := "sid_cccccccccccccccccccc"
	sidOld := "sid_dddddddddddddddddddd"
	m := newContractManager(t, mr)
	userID := int64(5)
	seedUnifiedSession(t, mr, secret, seededSession{SID: sidCurrent, JTI: "jti-cur", UserID: userID, Refresh: "r-cur"})
	seedUnifiedSession(t, mr, secret, seededSession{SID: sidOld, JTI: "jti-old", UserID: userID, Refresh: "r-old"})

	// security-service revokeAllSessionsExcept(keep=sidCurrent)
	sids, err := m.rdb.SMembers(context.Background(), authUserSidsKey(userID)).Result()
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range sids {
		if s == sidCurrent {
			continue
		}
		jti, _ := mr.Get(authSIDKey(s))
		_ = RevokeSessionFull(context.Background(), m.rdb, "mp:sess:", s, userID, jti)
	}

	if code := serveProfile(t, m, sidOld); code != http.StatusUnauthorized {
		t.Fatalf("old sid after password policy = %d, want 401", code)
	}
	if code := serveProfile(t, m, sidCurrent); code != http.StatusOK {
		t.Fatalf("current sid after password policy = %d, want 200", code)
	}
}

func TestContractRefreshAfterRevokeDoesNotRevive(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	secret := "test-secret-test-secret-test-secret-32"
	sid := "sid_eeeeeeeeeeeeeeeeeeee"
	jti := "jti-revoked"
	m := newContractManager(t, mr)
	seedUnifiedSession(t, mr, secret, seededSession{SID: sid, JTI: jti, UserID: 3, Refresh: "refresh-dead"})

	_ = m.RevokeSessionFull(context.Background(), sid, 3, jti)

	w := httptest.NewRecorder()
	m.handleRefresh()(w, httptestNewRequestWithCookie(http.MethodPost, "/api/auth/refresh", sid))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("refresh after revoke = %d, want 401", w.Code)
	}
	if mr.Exists("mp:sess:" + sid) {
		t.Fatal("refresh must not recreate mp:sess")
	}
}

func TestContractMultiAuthDeviceRegisterDoesNotEvictSibling(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	store := NewAuthDeviceStore(rdb)
	ctx := context.Background()
	sid := "sid_12345678901234567890"
	userID := int64(11)
	now := time.Now().UTC().Format(time.RFC3339)

	devA := "adev_aaaaaaaaaaaaaaaaaaaa"
	devB := "adev_bbbbbbbbbbbbbbbbbbbb"
	if err := store.Save(ctx, AuthDeviceRecord{AuthDeviceID: devA, SID: sid, UserID: userID, PublicKeySPKI: "c3BpLWE", CreatedAt: now, LastSeenAt: now}); err != nil {
		t.Fatal(err)
	}
	if err := store.Save(ctx, AuthDeviceRecord{AuthDeviceID: devB, SID: sid, UserID: userID, PublicKeySPKI: "c3BpLWI", CreatedAt: now, LastSeenAt: now}); err != nil {
		t.Fatal(err)
	}

	if !mr.Exists(authDeviceKey(devA)) || !mr.Exists(authDeviceKey(devB)) {
		t.Fatal("both auth devices must exist")
	}
	n, _ := mr.SCard(authSidDevicesKey(sid))
	if n != 2 {
		t.Fatalf("sid device set size = %d, want 2", n)
	}
}

func TestContractRevokeSessionFullClearsAllRedisLayers(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	sid := "sid_ffffffffffffffffffff"
	jti := "jti-full"
	userID := int64(8)
	devID := "adev_ffffffffffffffffffff"
	secret := "test-secret-test-secret-test-secret-32"
	seedUnifiedSession(t, mr, secret, seededSession{
		SID: sid, JTI: jti, UserID: userID, Refresh: "r", DeviceIDs: []string{devID},
	})
	mr.Set(authStepUpKey(sid), `{}`)
	mr.Set(authGraceKey(jti), "1")

	if err := RevokeSessionFull(context.Background(), rdb, "mp:sess:", sid, userID, jti); err != nil {
		t.Fatal(err)
	}
	assertSessionKeysAbsent(t, mr, sid, jti, userID, []string{devID})
}

// PEND-SEC-011: logout must not leave mp:sess when security internal revoke is down.
func TestContractRevokeSessionFull_ClearsRedisWhenSecuritySoTDown(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
	}))
	defer down.Close()

	secret := "test-secret-test-secret-test-secret-32"
	sid := "sid_gggggggggggggggggggg"
	jti := "jti-sot-down"
	userID := int64(42)
	seedUnifiedSession(t, mr, secret, seededSession{SID: sid, JTI: jti, UserID: userID, Refresh: "r-sot"})

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	m := &SessionManager{
		store:                &SessionStore{rdb: redisSessionKV{rdb: rdb}, keyPrefix: "mp:sess:", ttl: time.Hour},
		rdb:                  rdb,
		gatewaySessionPrefix: "mp:sess:",
		sot: NewSoTClient(SoTClientConfig{
			SecurityBaseURL: down.URL,
			ServiceKey:      "gateway-test-key",
			Mode:            SoTModeDualWrite,
		}),
	}

	sotErr := m.RevokeSessionFull(context.Background(), sid, userID, jti)
	if sotErr == nil {
		t.Fatal("expected security sot error when service is down")
	}
	assertSessionKeysAbsent(t, mr, sid, jti, userID, nil)
	if code := serveProfile(t, m, sid); code != http.StatusUnauthorized {
		t.Fatalf("profile after revoke with sot down = %d, want 401", code)
	}
}
