// Package devices is the ONLY package that mutates device state. Keep the API
// narrow: every state transition is a method on *Registry so we can add
// Prometheus metrics, audit logs, or distributed locks in one place later.
package devices

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/earflow/music-platform/device-sync-service/internal/config"
	"github.com/earflow/music-platform/device-sync-service/internal/observability"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// Domain errors. HTTP layer translates them — never return raw strings.
var (
	ErrInvalidUserID         = errors.New("invalid user id")
	ErrInvalidDeviceID       = errors.New("invalid device id")
	ErrDeviceNotFound        = errors.New("device not found")
	ErrNotOwned              = errors.New("device not owned by user")
	ErrNotActiveDevice       = errors.New("device is not active")
	ErrUnknownCommand        = errors.New("unknown command")
	ErrPayloadTooLarge       = errors.New("command payload too large")
	ErrStaleRevision         = errors.New("stale active revision")
	ErrInvalidCommandPayload = errors.New("invalid command payload")
)

var (
	userIDRe   = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
	deviceIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
)

const (
	maxUnknownDurationPositionSec   = 86400
	maxClientNowPlayingFutureSkewMs = 30000
	maxClientNowPlayingEventAgeMs   = 24 * 60 * 60 * 1000
)

// Registry is the Redis-backed service layer. Construct once, use many.
type Registry struct {
	rdb *redis.Client
	cfg *config.Config
	log *slog.Logger
	m   *observability.Metrics
}

func NewRegistry(rdb *redis.Client, cfg *config.Config, log *slog.Logger, m *observability.Metrics) *Registry {
	return &Registry{rdb: rdb, cfg: cfg, log: log, m: m}
}

// =============================================================================
// Key helpers. Centralized so a schema migration means changing this one file.
// =============================================================================

func (r *Registry) keyUser(uid string) string {
	return r.cfg.Redis.KeyPrefix + "user:" + uid + ":devices"
}
func (r *Registry) keyDevice(did string) string { return r.cfg.Redis.KeyPrefix + "device:" + did }
func (r *Registry) keyActive(uid string) string {
	return r.cfg.Redis.KeyPrefix + "user:" + uid + ":active"
}
func (r *Registry) keyActiveRevision(uid string) string {
	return r.cfg.Redis.KeyPrefix + "user:" + uid + ":active:rev"
}
func (r *Registry) keyNowPlaying(uid string) string {
	return r.cfg.Redis.KeyPrefix + "user:" + uid + ":np"
}

func (r *Registry) keyQueue(uid string) string {
	return r.cfg.Redis.KeyPrefix + "user:" + uid + ":queue"
}
func (r *Registry) keyTimeline(uid string) string {
	return r.cfg.Redis.KeyPrefix + "user:" + uid + ":timeline"
}
func (r *Registry) keyLease(uid string) string {
	return r.cfg.Redis.KeyPrefix + "user:" + uid + ":lease"
}
func (r *Registry) keyLeaseRevision(uid string) string {
	return r.cfg.Redis.KeyPrefix + "user:" + uid + ":lease:rev"
}
func (r *Registry) keyOutput(uid, did string) string {
	return r.cfg.Redis.KeyPrefix + "user:" + uid + ":output:" + did
}
func (r *Registry) keyTransfer(transferID string) string {
	return r.cfg.Redis.KeyPrefix + "transfer:" + transferID
}
func (r *Registry) keyActiveTransfer(uid string) string {
	return r.cfg.Redis.KeyPrefix + "user:" + uid + ":transfer:active"
}
func (r *Registry) keyTransfersActive() string {
	return r.cfg.Redis.KeyPrefix + "transfers:active"
}
func (r *Registry) keyIdempotency(uid, key string) string {
	if strings.TrimSpace(key) == "" {
		return ""
	}
	h := sha256.Sum256([]byte(uid + "\x1f" + key))
	enc := base64.RawURLEncoding.EncodeToString(h[:12])
	return r.cfg.Redis.KeyPrefix + "idempotency:" + uid + ":" + enc
}
func (r *Registry) keyCmdDedup(uid, commandID string) string {
	return r.cfg.Redis.KeyPrefix + "cmd:dedup:" + uid + ":" + commandID
}
func (r *Registry) keyUserClientMap(uid, clientKey string) string {
	if clientKey == "" {
		return ""
	}
	h := sha256.Sum256([]byte(uid + "\x1e" + clientKey))
	enc := base64.RawURLEncoding.EncodeToString(h[:12])
	return r.cfg.Redis.KeyPrefix + "ucm:" + uid + ":" + enc
}

// UserChannel is exported so the WS hub can subscribe to it.
func (r *Registry) UserChannel(uid string) string {
	return r.cfg.Redis.KeyPrefix + "events:user:" + uid
}

// =============================================================================
// Validation & sanitization. Every path into the registry goes through these.
// =============================================================================

func (r *Registry) normalizeUserID(uid string) (string, error) {
	uid = strings.TrimSpace(uid)
	if !userIDRe.MatchString(uid) {
		return "", ErrInvalidUserID
	}
	return uid, nil
}

func (r *Registry) normalizeDeviceID(did string) (string, error) {
	did = strings.TrimSpace(did)
	if !deviceIDRe.MatchString(did) {
		return "", ErrInvalidDeviceID
	}
	return did, nil
}

func sanitizeName(raw string) string {
	if raw == "" {
		return ""
	}
	b := make([]rune, 0, len(raw))
	for _, c := range raw {
		switch {
		case c == '\r' || c == '\n' || c == '\t':
			b = append(b, ' ')
		case c == '<' || c == '>':
			// strip
		case c < 0x20:
			// drop
		default:
			b = append(b, c)
		}
	}
	s := strings.TrimSpace(string(b))
	if len(s) > 48 {
		s = s[:48]
	}
	return s
}

func (r *Registry) sanitizeKind(kind string) string {
	v := strings.ToLower(strings.TrimSpace(kind))
	if _, ok := r.cfg.Device.AllowedKinds[v]; ok {
		return v
	}
	return "other"
}

// Stabil 64 chars: a-z A-Z 0-9 - _ (UUID from клиента)
func sanitizeClientKey(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	var b strings.Builder
	b.Grow(len(s))
	for _, c := range s {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' {
			b.WriteRune(c)
			if b.Len() >= 64 {
				break
			}
		}
	}
	return b.String()
}

// =============================================================================
// CRUD
// =============================================================================

// RegisterParams is the sanitized input set for RegisterDevice.
type RegisterParams struct {
	UserID    string
	Name      string
	Kind      string
	UserAgent string
	IP        string
	SessionID string
	// ClientKey — один id на вкладку/клиент; идемпотентная регистрация.
	ClientKey    string
	Capabilities *DeviceCapabilities
}

// RegisterDevice atomically creates a new device entry, enforces TTL, publishes
// devices:update. Caller MUST pass already-authenticated UserID.
func (r *Registry) RegisterDevice(ctx context.Context, p RegisterParams) (*Device, error) {
	uid, err := r.normalizeUserID(p.UserID)
	if err != nil {
		return nil, err
	}

	name := sanitizeName(p.Name)
	if name == "" {
		name = "Earflow Web"
	}
	kind := r.sanitizeKind(p.Kind)
	ua := truncate(p.UserAgent, 220)
	ip := truncate(p.IP, 64)
	sid := truncate(p.SessionID, 128)
	caps := normalizeDeviceCapabilities(p.Capabilities, kind)
	capsJSON := ""
	if caps != nil {
		if enc, err := json.Marshal(caps); err == nil {
			capsJSON = string(enc)
		}
	}

	ck := sanitizeClientKey(p.ClientKey)
	nowMs := time.Now().UnixMilli()
	ttl := r.cfg.Device.DeviceTTL
	userKey := r.keyUser(uid)

	// Повторная регистрация с тем же clientKey — тот же deviceId (без дублей "Windows PC").
	if ck != "" {
		mk := r.keyUserClientMap(uid, ck)
		if mk != "" {
			existingID, gerr := r.rdb.Get(ctx, mk).Result()
			if gerr == nil && existingID != "" {
				d, lerr := r.loadDevice(ctx, existingID)
				if lerr == nil && d != nil && d.UserID == uid {
					pipe := r.rdb.TxPipeline()
					pipe.HSet(ctx, r.keyDevice(d.ID), map[string]any{
						"name":         name,
						"kind":         kind,
						"userAgent":    ua,
						"ip":           ip,
						"lastSeenAt":   strconv.FormatInt(nowMs, 10),
						"sessionId":    sid,
						"clientKey":    ck,
						"capabilities": capsJSON,
					})
					pipe.Expire(ctx, r.keyDevice(d.ID), ttl)
					pipe.Expire(ctx, userKey, ttl)
					pipe.SAdd(ctx, userKey, d.ID)
					pipe.Set(ctx, mk, d.ID, ttl)
					if _, err := pipe.Exec(ctx); err != nil {
						return nil, fmt.Errorf("register device refresh: %w", err)
					}
					d.Name, d.Kind, d.UserAgent, d.IP = name, kind, ua, ip
					d.SessionID, d.LastSeenAt, d.ClientKey, d.Capabilities = sid, nowMs, ck, caps
					r.publish(ctx, uid, Event{Type: "devices:update", At: nowMs})
					return d, nil
				}
				_ = r.rdb.Del(ctx, mk).Err()
			}
		}
	}

	did := uuid.NewString()
	deviceKey := r.keyDevice(did)

	pipe := r.rdb.TxPipeline()
	hm := map[string]any{
		"userId":     uid,
		"name":       name,
		"kind":       kind,
		"userAgent":  ua,
		"ip":         ip,
		"createdAt":  strconv.FormatInt(nowMs, 10),
		"lastSeenAt": strconv.FormatInt(nowMs, 10),
		"sessionId":  sid,
	}
	if ck != "" {
		hm["clientKey"] = ck
	}
	if capsJSON != "" {
		hm["capabilities"] = capsJSON
	}
	pipe.HSet(ctx, deviceKey, hm)
	pipe.Expire(ctx, deviceKey, ttl)
	pipe.SAdd(ctx, userKey, did)
	pipe.Expire(ctx, userKey, ttl)
	if ck != "" {
		mk := r.keyUserClientMap(uid, ck)
		if mk != "" {
			pipe.Set(ctx, mk, did, ttl)
		}
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return nil, fmt.Errorf("register device: %w", err)
	}

	// LRU eviction is a best-effort pass; a failure here does not invalidate
	// the new device but is logged for observability.
	if err := r.evictOverLimit(ctx, uid); err != nil {
		r.log.Warn("evict over limit failed", slog.String("userId", uid), slog.Any("err", err))
	}

	r.publish(ctx, uid, Event{Type: "devices:update", At: nowMs})
	if r.m != nil {
		r.m.DevicesActive.Inc()
	}
	r.log.Info("device registered",
		slog.String("userId", uid),
		slog.String("deviceId", did),
		slog.String("kind", kind),
	)
	return &Device{
		ID: did, UserID: uid, Name: name, Kind: kind,
		CreatedAt: nowMs, LastSeenAt: nowMs, Capabilities: caps,
	}, nil
}

// loadDevice returns the raw device record, or (nil, nil) if absent.
func (r *Registry) loadDevice(ctx context.Context, did string) (*Device, error) {
	did, err := r.normalizeDeviceID(did)
	if err != nil {
		return nil, err
	}
	data, err := r.rdb.HGetAll(ctx, r.keyDevice(did)).Result()
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return nil, nil
	}
	uid, ok := data["userId"]
	if !ok || uid == "" {
		return nil, nil
	}
	d := &Device{
		ID:         did,
		UserID:     uid,
		Name:       data["name"],
		Kind:       data["kind"],
		UserAgent:  data["userAgent"],
		IP:         data["ip"],
		CreatedAt:  parseInt64(data["createdAt"]),
		LastSeenAt: parseInt64(data["lastSeenAt"]),
		SessionID:  data["sessionId"],
		ClientKey:  data["clientKey"],
	}
	if raw := strings.TrimSpace(data["capabilities"]); raw != "" {
		var caps DeviceCapabilities
		if err := json.Unmarshal([]byte(raw), &caps); err == nil {
			d.Capabilities = normalizeDeviceCapabilities(&caps, d.Kind)
		}
	}
	return d, nil
}

// TouchDevice refreshes lastSeenAt and TTL. Cheap enough to call on every WS
// heartbeat. Returns (nil, nil) if the device disappeared.
func (r *Registry) TouchDevice(ctx context.Context, did string) (*Device, error) {
	d, err := r.loadDevice(ctx, did)
	if err != nil {
		return nil, err
	}
	if d == nil {
		return nil, nil
	}
	nowMs := time.Now().UnixMilli()
	ttl := r.cfg.Device.DeviceTTL
	pipe := r.rdb.TxPipeline()
	pipe.HSet(ctx, r.keyDevice(did), "lastSeenAt", strconv.FormatInt(nowMs, 10))
	pipe.Expire(ctx, r.keyDevice(did), ttl)
	pipe.Expire(ctx, r.keyUser(d.UserID), ttl)
	activeID, _ := r.rdb.Get(ctx, r.keyActive(d.UserID)).Result()
	if activeID == did {
		pipe.Expire(ctx, r.keyActive(d.UserID), ttl)
		pipe.Persist(ctx, r.keyActiveRevision(d.UserID))
	}
	if strings.TrimSpace(d.ClientKey) != "" {
		mk := r.keyUserClientMap(d.UserID, d.ClientKey)
		if mk != "" {
			pipe.Expire(ctx, mk, ttl)
		}
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return nil, err
	}
	d.LastSeenAt = nowMs
	return d, nil
}

// RemoveDevice deletes a device and clears it from the user's set + active
// pointer if it pointed there. Idempotent.
func (r *Registry) RemoveDevice(ctx context.Context, userID, did string) error {
	uid, err := r.normalizeUserID(userID)
	if err != nil {
		return err
	}
	d, err := r.loadDevice(ctx, did)
	if err != nil {
		return err
	}
	if d == nil {
		return ErrDeviceNotFound
	}
	if d.UserID != uid {
		return ErrNotOwned
	}
	ck := strings.TrimSpace(d.ClientKey)
	pipe := r.rdb.TxPipeline()
	pipe.SRem(ctx, r.keyUser(uid), did)
	pipe.Del(ctx, r.keyDevice(did))
	if ck != "" {
		mk := r.keyUserClientMap(uid, ck)
		if mk != "" {
			pipe.Del(ctx, mk)
		}
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return err
	}

	// If this was the active device, clear the pointer. Done non-transactionally
	// — racing with SetActive is fine: the user just loses the pointer briefly
	// and reacquires it via the incoming transfer broadcast.
	activeID, _ := r.rdb.Get(ctx, r.keyActive(uid)).Result()
	if activeID == did {
		_ = r.rdb.Del(ctx, r.keyActive(uid)).Err()
	}

	r.publish(ctx, uid, Event{Type: "devices:update", At: time.Now().UnixMilli()})
	if r.m != nil {
		r.m.DevicesActive.Dec()
	}
	r.log.Info("device removed",
		slog.String("userId", uid),
		slog.String("deviceId", did),
	)
	return nil
}

// ListDevices returns every live device for the user plus the current active
// flag. Stale entries encountered during the scan are garbage-collected.
func (r *Registry) ListDevices(ctx context.Context, userID string) ([]*Device, *NowPlaying, error) {
	uid, err := r.normalizeUserID(userID)
	if err != nil {
		return nil, nil, err
	}
	ids, err := r.rdb.SMembers(ctx, r.keyUser(uid)).Result()
	if err != nil {
		return nil, nil, err
	}
	active, _ := r.rdb.Get(ctx, r.keyActive(uid)).Result()

	out := make([]*Device, 0, len(ids))
	for _, id := range ids {
		d, err := r.loadDevice(ctx, id)
		if err != nil {
			return nil, nil, err
		}
		if d == nil {
			// stale — prune
			_ = r.rdb.SRem(ctx, r.keyUser(uid), id).Err()
			continue
		}
		d.IsActive = active == id
		out = append(out, d)
	}

	if r.cfg != nil && r.cfg.Device.ListHideStaleAfter > 0 {
		nowMs := time.Now().UnixMilli()
		cut := nowMs - r.cfg.Device.ListHideStaleAfter.Milliseconds()
		filtered := make([]*Device, 0, len(out))
		for _, d := range out {
			if d == nil {
				continue
			}
			// Активный плеер и недавние пинги — в панели; остальное не показывать
			// (телек без открытого приложения, старые вкладки), по аналогии со Spotify Connect.
			if d.IsActive || d.LastSeenAt >= cut {
				filtered = append(filtered, d)
			}
		}
		out = filtered
	}

	// Newest activity first — purely presentational ordering.
	sortByLastSeenDesc(out)

	np, err := r.GetNowPlaying(ctx, uid)
	if err != nil {
		return nil, nil, err
	}
	if np != nil {
		if rev, rerr := r.activeRevisionForNormalizedUser(ctx, uid); rerr == nil {
			np.ActiveRevision = rev
		}
	}
	return out, np, nil
}

func (r *Registry) GetActiveRevision(ctx context.Context, userID string) (int64, error) {
	uid, err := r.normalizeUserID(userID)
	if err != nil {
		return 0, err
	}
	return r.activeRevisionForNormalizedUser(ctx, uid)
}

func (r *Registry) activeRevisionForNormalizedUser(ctx context.Context, uid string) (int64, error) {
	rev, err := r.rdb.Get(ctx, r.keyActiveRevision(uid)).Int64()
	if errors.Is(err, redis.Nil) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	if rev < 0 {
		return 0, nil
	}
	return rev, nil
}

// evictOverLimit trims the oldest devices beyond MaxPerUser. Best-effort,
// uses a non-transactional flow: small race windows are preferable to long
// locks on the user hash.
func (r *Registry) evictOverLimit(ctx context.Context, uid string) error {
	ids, err := r.rdb.SMembers(ctx, r.keyUser(uid)).Result()
	if err != nil {
		return err
	}
	if len(ids) <= r.cfg.Device.MaxPerUser {
		return nil
	}
	devs := make([]*Device, 0, len(ids))
	for _, id := range ids {
		d, _ := r.loadDevice(ctx, id)
		if d != nil {
			devs = append(devs, d)
		}
	}
	sortByLastSeenAsc(devs)
	for len(devs) > r.cfg.Device.MaxPerUser {
		oldest := devs[0]
		devs = devs[1:]
		_ = r.RemoveDevice(ctx, uid, oldest.ID)
	}
	return nil
}

// =============================================================================
// Active-device election (server-authoritative transfer protocol)
// =============================================================================

func (r *Registry) buildTransferredNowPlaying(ctx context.Context, uid, did string, nowMs int64, resumeOverride *bool) *NowPlaying {
	raw, err := r.rdb.Get(ctx, r.keyNowPlaying(uid)).Result()
	if err != nil || raw == "" {
		return nil
	}

	var np NowPlaying
	if err := json.Unmarshal([]byte(raw), &np); err != nil {
		return nil
	}
	if strings.TrimSpace(np.TrackID) == "" {
		return nil
	}

	if np.IsPlaying && np.UpdatedAtMs > 0 && nowMs > np.UpdatedAtMs {
		np.PositionSec = clamp64(np.PositionSec+((nowMs-np.UpdatedAtMs)/1000), 0, maxNowPlayingPosition(np.DurationSec))
	}
	if resumeOverride != nil {
		np.IsPlaying = *resumeOverride
	}
	np.DeviceID = did
	np.UpdatedAtMs = nowMs
	np.StateRevision++
	np.ClientSeq = 0
	np.ClientEventAtMs = nowMs
	if np.StateRevision <= 0 {
		np.StateRevision = 1
	}
	return &np
}

func (r *Registry) buildBootstrappedNowPlaying(ctx context.Context, uid, did string, nowMs int64, resumeOverride *bool, in *NowPlaying) *NowPlaying {
	if in == nil || strings.TrimSpace(in.TrackID) == "" {
		return nil
	}

	clientEventAtMs, clientEventAtValid := normalizeClientEventAtMs(in.ClientEventAtMs, nowMs)
	clientSeq := normalizeClientSeq(in.ClientSeq)
	durationSec := clamp64(in.DurationSec, 0, maxUnknownDurationPositionSec)
	maxPos := durationSec
	if maxPos <= 0 {
		maxPos = maxUnknownDurationPositionSec
	}
	positionSec := clamp64(in.PositionSec, 0, maxPos)
	isPlaying := in.IsPlaying
	if resumeOverride != nil {
		isPlaying = *resumeOverride
	}
	if isPlaying && clientEventAtValid && nowMs > clientEventAtMs {
		positionSec = clamp64(positionSec+((nowMs-clientEventAtMs)/1000), 0, maxPos)
	}

	nextRev := int64(1)
	if raw, err := r.rdb.Get(ctx, r.keyNowPlaying(uid)).Result(); err == nil && raw != "" {
		var prev NowPlaying
		if json.Unmarshal([]byte(raw), &prev) == nil && prev.StateRevision > 0 {
			nextRev = prev.StateRevision + 1
			if nextRev <= 0 {
				nextRev = 1
			}
		}
	}

	return &NowPlaying{
		TrackID:         truncate(in.TrackID, 128),
		Title:           truncate(in.Title, 200),
		Artist:          truncate(in.Artist, 200),
		Cover:           truncate(in.Cover, 512),
		DurationSec:     durationSec,
		IsPlaying:       isPlaying,
		PositionSec:     positionSec,
		UpdatedAtMs:     nowMs,
		DeviceID:        did,
		StateRevision:   nextRev,
		QueueSource:     truncate(in.QueueSource, 32),
		QueueName:       truncate(in.QueueName, 120),
		ClientSeq:       clientSeq,
		ClientEventAtMs: clientEventAtMs,
	}
}

func maxNowPlayingPosition(durationSec int64) int64 {
	if durationSec > 0 {
		return durationSec
	}
	return maxUnknownDurationPositionSec
}

func (r *Registry) GetActiveDeviceID(ctx context.Context, userID string) (string, error) {
	uid, err := r.normalizeUserID(userID)
	if err != nil {
		return "", err
	}
	v, err := r.rdb.Get(ctx, r.keyActive(uid)).Result()
	if errors.Is(err, redis.Nil) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return v, nil
}

// recordSeekServerState applies a `cmd:seek` as a write to nowPlaying SoT at
// the moment the intent arrives, BEFORE the active device itself publishes
// np:update. This is what fixes seek-drift across devices: previously the
// authoritative position stayed stale until the active device's client-side
// event loop noticed the seek; on backgrounded mobile (iOS WKWebView) that
// could lag 2-6s. Now any listener that arrives between the intent and the
// active's own np:publish still sees the correct seek position.
//
// The write is fencing-safe:
//   - only when `to == activeID` (i.e. the seek targets the current owner);
//   - only mutates PositionSec/UpdatedAtMs/ClientSeq/ClientEventAtMs — never
//     touches TrackID, IsPlaying, QueueSource (they stay owned by the
//     active device's own np:update writes);
//   - skips STALE detection: this is an intent-driven update, not a replay.
//
// Returns nil on success. Errors are non-fatal to SendCommand (the relay
// already happened) but logged for diagnosis.
func (r *Registry) recordSeekServerState(ctx context.Context, uid, activeID string, positionSec float64) error {
	if uid == "" || activeID == "" {
		return nil
	}
	prev, err := r.GetNowPlaying(ctx, uid)
	if err != nil || prev == nil {
		return err
	}
	if prev.DeviceID != activeID {
		// seek routed to a non-owner device (already rejected above, but
		// defensive) — do not touch SoT.
		return nil
	}
	nowMs := time.Now().UnixMilli()
	maxPos := maxNowPlayingPosition(prev.DurationSec)
	next := &NowPlaying{
		TrackID:         prev.TrackID,
		Title:           prev.Title,
		Artist:          prev.Artist,
		Cover:           prev.Cover,
		DurationSec:     prev.DurationSec,
		IsPlaying:       prev.IsPlaying,
		PositionSec:     clamp64(int64(positionSec+0.5), 0, maxPos),
		UpdatedAtMs:     nowMs,
		DeviceID:        prev.DeviceID,
		StateRevision:   prev.StateRevision + 1, // bump so receivers see a fresh rev
		ActiveRevision:  prev.ActiveRevision,
		QueueSource:     prev.QueueSource,
		QueueName:       prev.QueueName,
		ClientSeq:       prev.ClientSeq, // keep last real client seq
		ClientEventAtMs: nowMs,
	}
	enc, err := json.Marshal(next)
	if err != nil {
		return err
	}
	if err := r.rdb.Set(ctx, r.keyNowPlaying(uid), enc, r.cfg.Device.NowPlayingTTL).Err(); err != nil {
		return err
	}
	return nil
}

func (r *Registry) recordPauseServerState(ctx context.Context, uid, activeID string) error {
	if uid == "" || activeID == "" {
		return nil
	}
	prev, err := r.GetNowPlaying(ctx, uid)
	if err != nil || prev == nil {
		return err
	}
	if prev.DeviceID != activeID {
		return nil
	}
	if !prev.IsPlaying {
		return nil // already paused
	}
	nowMs := time.Now().UnixMilli()
	next := *prev
	next.IsPlaying = false
	next.UpdatedAtMs = nowMs
	next.ClientEventAtMs = nowMs
	next.StateRevision++
	if next.StateRevision <= 0 {
		next.StateRevision = 1
	}
	enc, err := json.Marshal(next)
	if err != nil {
		return err
	}
	return r.rdb.Set(ctx, r.keyNowPlaying(uid), enc, r.cfg.Device.NowPlayingTTL).Err()
}

func transferRevokePayload(activeDeviceID string, activeRevision int64, np *NowPlaying) map[string]interface{} {
	return map[string]interface{}{
		"reason":         "transfer",
		"activeDeviceId": activeDeviceID,
		"activeRevision": activeRevision,
		"nowPlaying":     np,
	}
}

// =============================================================================
// Now-playing (stateRevision-dedup write path)
// =============================================================================

// PutNowPlaying accepts an incoming snapshot, rejects if older than current,
// and publishes np:update. All field validation is done here — clients never
// need to know the shape rules.
func (r *Registry) PutNowPlaying(ctx context.Context, userID string, in *NowPlaying) (*NowPlayingWriteResult, error) {
	uid, err := r.normalizeUserID(userID)
	if err != nil {
		return nil, err
	}
	if in == nil {
		in = &NowPlaying{}
	}

	did, err := r.normalizeDeviceID(in.DeviceID)
	if err != nil {
		return nil, err
	}
	d, err := r.loadDevice(ctx, did)
	if err != nil {
		return nil, err
	}
	if d == nil {
		return nil, ErrDeviceNotFound
	}
	if d.UserID != uid {
		return nil, ErrNotOwned
	}

	nowMs := time.Now().UnixMilli()
	clientEventAtMs, clientEventAtValid := normalizeClientEventAtMs(in.ClientEventAtMs, nowMs)
	clientSeq := normalizeClientSeq(in.ClientSeq)
	incomingActiveRevision := normalizeActiveRevision(in.ActiveRevision)
	key := r.keyNowPlaying(uid)
	activeKey := r.keyActive(uid)
	activeRevisionKey := r.keyActiveRevision(uid)

	var out *NowPlaying
	var accepted bool
	var reason string
	var restoredActive bool
	var lastErr error

	for attempt := 0; attempt < 3; attempt++ {
		restoredActive = false
		reason = ""
		lastErr = r.rdb.Watch(ctx, func(tx *redis.Tx) error {
			var prev *NowPlaying
			raw, err := tx.Get(ctx, key).Result()
			if err != nil && !errors.Is(err, redis.Nil) {
				return err
			}
			if raw != "" {
				var p NowPlaying
				if jerr := json.Unmarshal([]byte(raw), &p); jerr == nil {
					prev = &p
				}
			}

			activeID, err := tx.Get(ctx, activeKey).Result()
			if err != nil && !errors.Is(err, redis.Nil) {
				return err
			}
			if activeID == "" {
				if prev == nil || prev.DeviceID != did || strings.TrimSpace(prev.TrackID) == "" {
					return ErrNotActiveDevice
				}
				restoredActive = true
			} else if activeID != did {
				return ErrNotActiveDevice
			}
			currentActiveRevision := int64(0)
			if rev, rerr := tx.Get(ctx, activeRevisionKey).Int64(); rerr == nil {
				currentActiveRevision = rev
			} else if !errors.Is(rerr, redis.Nil) {
				return rerr
			}
			if incomingActiveRevision > 0 && currentActiveRevision > 0 && incomingActiveRevision != currentActiveRevision {
				out = prev
				accepted = false
				reason = NowPlayingRejectReasonStaleRevision
				return nil
			}
			if isStaleNowPlayingUpdate(prev, did, clientEventAtMs, clientSeq) {
				out = prev
				accepted = false
				reason = NowPlayingRejectReasonStale
				return nil
			}

			durationSec := clamp64(in.DurationSec, 0, maxUnknownDurationPositionSec)
			maxPos := durationSec
			if maxPos <= 0 {
				maxPos = maxUnknownDurationPositionSec
			}
			positionSec := clamp64(in.PositionSec, 0, maxPos)
			if in.IsPlaying && clientEventAtValid && nowMs > clientEventAtMs {
				positionSec = clamp64(positionSec+((nowMs-clientEventAtMs)/1000), 0, maxPos)
			}

			nextRev := int64(1)
			if prev != nil {
				nextRev = prev.StateRevision + 1
				if nextRev <= 0 {
					nextRev = 1
				}
			}
			np := &NowPlaying{
				TrackID:         truncate(in.TrackID, 128),
				Title:           truncate(in.Title, 200),
				Artist:          truncate(in.Artist, 200),
				Cover:           truncate(in.Cover, 512),
				DurationSec:     durationSec,
				IsPlaying:       in.IsPlaying,
				PositionSec:     positionSec,
				UpdatedAtMs:     nowMs,
				DeviceID:        did,
				StateRevision:   nextRev,
				ActiveRevision:  currentActiveRevision,
				QueueSource:     truncate(in.QueueSource, 32),
				QueueName:       truncate(in.QueueName, 120),
				ClientSeq:       clientSeq,
				ClientEventAtMs: clientEventAtMs,
			}
			enc, err := json.Marshal(np)
			if err != nil {
				return err
			}
			_, err = tx.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
				pipe.Set(ctx, key, enc, r.cfg.Device.NowPlayingTTL)
				pipe.Set(ctx, activeKey, did, r.cfg.Device.DeviceTTL)
				if restoredActive {
					pipe.Incr(ctx, activeRevisionKey)
				}
				pipe.Persist(ctx, activeRevisionKey)
				return nil
			})
			if err != nil {
				return err
			}
			out = np
			accepted = true
			return nil
		}, key, activeKey, activeRevisionKey)
		if errors.Is(lastErr, redis.TxFailedErr) {
			continue
		}
		break
	}
	if lastErr != nil {
		return nil, lastErr
	}
	if out == nil {
		return nil, nil
	}
	if !accepted {
		if r.m != nil {
			r.m.StaleRejected.WithLabelValues(rejectMetricReason(reason)).Inc()
			if reason == NowPlayingRejectReasonStaleRevision {
				r.m.RevisionRejected.Inc()
			}
		}
		activeRevision, _ := r.rdb.Get(ctx, activeRevisionKey).Int64()
		if out != nil {
			out.ActiveRevision = activeRevision
		}
		return &NowPlayingWriteResult{NowPlaying: out, Accepted: false, Reason: reason, ActiveRevision: activeRevision}, nil
	}

	activeRevision, _ := r.rdb.Get(ctx, activeRevisionKey).Int64()
	out.ActiveRevision = activeRevision
	if restoredActive {
		if r.m != nil {
			r.m.Reconcile.WithLabelValues("restored_active").Inc()
		}
		r.publish(ctx, uid, Event{
			Type:           "devices:active",
			At:             out.UpdatedAtMs,
			DeviceID:       strPtr(did),
			ActiveRevision: activeRevision,
		})
	}
	r.publish(ctx, uid, Event{
		Type:           "np:update",
		At:             out.UpdatedAtMs,
		ActiveRevision: activeRevision,
		State:          out,
	})
	timeline := timelineFromNowPlaying(out)
	if timeline != nil {
		if enc, err := json.Marshal(timeline); err == nil {
			_ = r.rdb.Set(ctx, r.keyTimeline(uid), enc, r.cfg.Device.NowPlayingTTL).Err()
		}
		r.publishTimelineUpdate(ctx, uid, timeline, activeRevision)
	}
	return &NowPlayingWriteResult{NowPlaying: out, Accepted: true, ActiveRevision: activeRevision}, nil
}

// GetNowPlaying reads the authoritative snapshot. Returns (nil, nil) if unset.
func (r *Registry) GetNowPlaying(ctx context.Context, userID string) (*NowPlaying, error) {
	uid, err := r.normalizeUserID(userID)
	if err != nil {
		return nil, err
	}
	raw, err := r.rdb.Get(ctx, r.keyNowPlaying(uid)).Result()
	if errors.Is(err, redis.Nil) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var np NowPlaying
	if err := json.Unmarshal([]byte(raw), &np); err != nil {
		return nil, nil
	}
	return &np, nil
}

// =============================================================================
// Commands (directed / broadcast)
// =============================================================================

var allowedCommands = map[string]struct{}{
	"play":       {},
	"pause":      {},
	"next":       {},
	"previous":   {},
	"seek":       {},
	"set_volume": {},

	// Server-owned queue intents (DECISIONS 2026-08-10 TrackSync):
	"queue:set": {},
}

// SendCommand validates and publishes a user-originated controller intent. The
// active output device remains server-authoritative: empty targets are resolved
// to the current active device and stale activeRevision values are fenced.
func (r *Registry) SendCommand(ctx context.Context, userID, fromDeviceID, to, cmd string, payload map[string]interface{}, activeRevision int64) error {
	uid, err := r.normalizeUserID(userID)
	if err != nil {
		return err
	}
	if _, ok := allowedCommands[cmd]; !ok {
		r.recordCommandRejected("unknown_command")
		return ErrUnknownCommand
	}
	fromDeviceID, err = r.normalizeDeviceID(fromDeviceID)
	if err != nil {
		r.recordCommandRejected("invalid_from")
		return ErrInvalidDeviceID
	}
	fromDevice, err := r.loadDevice(ctx, fromDeviceID)
	if err != nil {
		return err
	}
	if fromDevice == nil {
		r.recordCommandRejected("from_not_found")
		return ErrDeviceNotFound
	}
	if fromDevice.UserID != uid {
		r.recordCommandRejected("not_owned")
		return ErrNotOwned
	}

	activeID, _ := r.rdb.Get(ctx, r.keyActive(uid)).Result()

	// Spotify-style transfer-on-play: when `play` arrives from a device that
	// is not the current active output, treat it as the explicit user intent
	// "make me active". The server runs the normal transfer FSM, which itself
	// publishes the revoke and activate commands (activate carries resume=true,
	// so the new device will start audio without a separate `play` relay).
	//
	// This is intentionally before the stale-revision and not-active-device
	// fences: those checks defend controllers from acting on a stale view of
	// the output owner, but a `play` is an ownership-transfer intent, not a
	// controller action against the existing owner. Stale ActiveRevision from
	// the client is irrelevant here — the server is the sole authority.
	if cmd == "play" && (activeID == "" || activeID != fromDeviceID) {
		if err := ensureCommandPayloadSize(payload, r.cfg.Device.MaxCommandPayloadBytes); err != nil {
			r.recordCommandRejected("payload_too_large")
			return err
		}
		bootstrapNowPlaying := commandNowPlayingPayload(payload)
		resumeTrue := true
		if _, _, _, terr := r.startTransfer(ctx, uid, fromDeviceID, &resumeTrue, "", bootstrapNowPlaying); terr != nil {
			return terr
		}
		if r.m != nil {
			r.m.Commands.WithLabelValues("transfer_on_play").Inc()
		}
		return nil
	}

	if activeID == "" && cmd != "queue:set" {
		r.recordCommandRejected("no_active_output")
		return ErrNotActiveDevice
	}
	currentActiveRevision, err := r.activeRevisionForNormalizedUser(ctx, uid)
	if err != nil {
		return err
	}
	incomingActiveRevision := normalizeActiveRevision(activeRevision)
	if incomingActiveRevision > 0 && currentActiveRevision > 0 && incomingActiveRevision != currentActiveRevision {
		r.recordCommandRejected("stale_revision")
		if r.m != nil {
			r.m.RevisionRejected.Inc()
		}
		return ErrStaleRevision
	}

	targetID := strings.TrimSpace(to)
	if targetID == "" {
		targetID = activeID
	}
	targetID, err = r.normalizeDeviceID(targetID)
	if err != nil {
		r.recordCommandRejected("invalid_target")
		return ErrInvalidDeviceID
	}
	// queue:set is broadcast to the sync scope (user), not device-targeted.
	// Any owned device may write the queue.
	if cmd == "queue:set" {
		if _, err := r.loadDevice(ctx, fromDeviceID); err != nil {
			return err
		}
	} else if targetID != activeID {
		r.recordCommandRejected("target_not_active")
		return ErrNotActiveDevice
	}
	d, err := r.loadDevice(ctx, targetID)
	if err != nil {
		return err
	}
	if d == nil || d.UserID != uid {
		r.recordCommandRejected("target_not_found")
		return ErrDeviceNotFound
	}

	payload, err = normalizeCommandPayload(cmd, payload)
	if err != nil {
		r.recordCommandRejected("invalid_payload")
		return err
	}
	payload["activeDeviceId"] = activeID
	payload["activeRevision"] = currentActiveRevision
	payload["controllerDeviceId"] = fromDeviceID
	if _, ok := payload["commandId"]; !ok {
		payload["commandId"] = uuid.NewString()
	}
	enc, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if len(enc) > r.cfg.Device.MaxCommandPayloadBytes {
		r.recordCommandRejected("payload_too_large")
		return ErrPayloadTooLarge
	}
	if cmd == "set_volume" {
		if v, ok := numberFromPayload(payload, "volume"); ok {
			r.setDeviceVolumeForNormalizedUser(ctx, uid, targetID, v)
		}
	}

	// Snapshot piggyback (DECISIONS 2026-08-10 TrackSync/#2+#3):
	// - For queue-mutation intents (next/previous/queue:set) we resolve the
	//   snapshot AFTER the mutation runs (below) so the piggybacked np reflects
	//   the NEW track. Before that point snapshotForCmd is left nil.
	// - For seek/play/pause (position-only or ownership intents), piggyback
	//   applies to the current nowPlaying — read it up front.
	var snapshotForCmd *NowPlaying
	switch cmd {
	case "seek", "play", "pause":
		if np, npErr := r.GetNowPlaying(ctx, uid); npErr == nil && np != nil {
			snapshotForCmd = np
		}
	}

	// Intent→SoT mirror (DECISIONS 2026-08-10 TrackSync):
	// for seek commands we persist the new position into nowPlaying BEFORE
	// broadcasting. This makes any in-flight or later-arriving listDevices /
	// player_state frame already carry the correct position even if the
	// active device's own np:update is delayed (iOS WKWebView background,
	// network batching).
	switch cmd {
	case "seek":
		if pos, ok := numberFromPayload(payload, "positionSec"); ok {
			if err := r.recordSeekServerState(ctx, uid, activeID, pos); err != nil {
				r.log.Warn("seek intent→state failed (non-fatal)",
					slog.String("userId", uid),
					slog.Any("err", err))
			}
		}
	case "pause":
		if err := r.recordPauseServerState(ctx, uid, activeID); err != nil {
			r.log.Warn("pause intent→state failed (non-fatal)",
				slog.String("userId", uid),
				slog.Any("err", err))
		}
	case "queue:set":
		err := r.applyQueueSetIntent(ctx, uid, activeID, fromDeviceID, payload)
		if err != nil {
			r.log.Debug("queue:set apply outcome",
				slog.String("userId", uid),
				slog.Any("err", err))
			r.recordCommandRejected("queue_set_failed")
			return err
		}
	case "next", "previous":
		if err := r.applyQueueAdvanceIntent(ctx, uid, activeID, cmd == "next"); err != nil {
			r.log.Warn("next/prev queue advance failed (non-fatal)",
				slog.String("userId", uid),
				slog.String("cmd", cmd),
				slog.Any("err", err))
		}
	}

	// After queue mutations, refresh snapshotForCmd from the NEW state so
	// receivers see the new track in the cmd frame itself (DECISIONS
	// 2026-08-10 TrackSync/#3).
	if cmd == "next" || cmd == "previous" || cmd == "queue:set" {
		if np, npErr := r.GetNowPlaying(ctx, uid); npErr == nil && np != nil {
			snapshotForCmd = np
		}
	}

	// If queue was mutated and refreshed snapshot exists, ALSO persist the
	// queue context inside nowPlaying so listDevices and player_state readers
	// see the newest queue state without a second fetch.
	if (cmd == "next" || cmd == "previous" || cmd == "queue:set") && snapshotForCmd != nil {
		if q := r.queueForNormalizedUser(ctx, uid); q != nil {
			snapshotForCmd.QueueRevision = q.Revision
			snapshotForCmd.QueueIndex = q.Index
			snapshotForCmd.QueueSource = q.QueueSource
			snapshotForCmd.QueueName = q.QueueName
			// Persist nowPlaying with the refreshed queue context so ListDevices
			// and player_state readers see it without a second fetch.
			enc, encErr := json.Marshal(snapshotForCmd)
			if encErr == nil {
				_ = r.rdb.Set(ctx, r.keyNowPlaying(uid), enc, r.cfg.Device.NowPlayingTTL).Err()
			}
		}
	}

	nowMs := time.Now().UnixMilli()
	fromCopy := fromDeviceID
	toPtr := strPtr(targetID)
	if snapshotForCmd != nil {
		if payload == nil {
			payload = make(map[string]interface{}, 4)
		}
		payload["nowPlaying"] = snapshotForCmd
	}
	r.publish(ctx, uid, Event{
		Type:    "cmd",
		At:      nowMs,
		From:    strPtr(fromCopy),
		To:      toPtr,
		Cmd:     cmd,
		Payload: payload,
	})
	// After every meaningful playback intent, publish player_state so all
	// connected devices observe the new authoritative snapshot. This is
	// server-side aggregation: one extra Redis Publish per cmd, zero extra
	// work for clients. Fixes the window where only the active device knew
	// "the seek happened".
	// queue:set + next/previous ALSO flip track/queue state — they must trigger
	// player_state publish too, otherwise peers learn about it only when the
	// active device's own np:update arrives (that is the old 2s drift).
	switch cmd {
	case "seek", "play", "pause", "next", "previous", "set_volume", "queue:set":
		r.publishPlayerState(ctx, uid)
	}
	if r.m != nil {
		r.m.Commands.WithLabelValues(cmd).Inc()
	}
	r.log.Debug("device command routed",
		slog.String("userId", uid),
		slog.String("controllerDeviceId", fromDeviceID),
		slog.String("activeDeviceId", activeID),
		slog.String("cmd", cmd),
		slog.Int64("activeRevision", currentActiveRevision),
	)
	return nil
}

func (r *Registry) recordCommandRejected(reason string) {
	if r != nil && r.m != nil {
		r.m.CommandRejected.WithLabelValues(rejectMetricReason(reason)).Inc()
	}
}

// =============================================================================
// Pub/Sub helper
// =============================================================================

// publish ships a legacy frame and mirrors it into the unified `player_state`
// frame (PEND-DS-001). Legacy frames stay for one release for compatibility.
func (r *Registry) publish(ctx context.Context, uid string, ev Event) {
	r.publishEvent(ctx, uid, ev)
	if _, ok := playerStateTriggerFrames[ev.Type]; ok {
		r.publishPlayerState(ctx, uid)
	}
}

func (r *Registry) publishEvent(ctx context.Context, uid string, ev Event) {
	enc, err := json.Marshal(ev)
	if err != nil {
		r.log.Warn("publish marshal failed", slog.Any("err", err))
		return
	}
	if err := r.rdb.Publish(ctx, r.UserChannel(uid), enc).Err(); err != nil {
		r.log.Warn("publish failed",
			slog.String("userId", uid),
			slog.String("type", ev.Type),
			slog.Any("err", err))
		if r.m != nil {
			r.m.RedisPubDropped.Inc()
		}
	}
}

// =============================================================================
// misc helpers
// =============================================================================

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// isValidTrackId is a conservative gate used for queue payloads. Rejects
// strings that are obviously not UUIDs / numeric ids to catch injection / XSS
// attempts early. The player still does its own fetch — this just keeps the certificate
// bandwidth in Redis smaller and reduces the size of exploit payload.
//
// Allowed forms:
//   - numeric database id: "12345"
//   - UUID v1..v5: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" (36 chars)
//   - opaque alphanum+underscore/hyphen (catalog identities), up to 64 chars.
var trackIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

func isValidTrackId(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" || len(s) > 64 {
		return false
	}
	return trackIDPattern.MatchString(s)
}

func clamp64(v, lo, hi int64) int64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func normalizeClientSeq(v int64) int64 {
	if v <= 0 {
		return 0
	}
	const maxClientSeq = 1 << 53
	if v > maxClientSeq {
		return maxClientSeq
	}
	return v
}

func normalizeActiveRevision(v int64) int64 {
	if v <= 0 {
		return 0
	}
	const maxRevision = 1 << 62
	if v > maxRevision {
		return maxRevision
	}
	return v
}

func normalizeCommandPayload(cmd string, payload map[string]interface{}) (map[string]interface{}, error) {
	out := make(map[string]interface{}, 4)
	switch cmd {
	case "seek":
		pos, ok := numberFromPayload(payload, "positionSec")
		if !ok || pos < 0 || pos > float64(maxUnknownDurationPositionSec) {
			return nil, ErrInvalidCommandPayload
		}
		out["positionSec"] = pos
	case "set_volume":
		volume, ok := numberFromPayload(payload, "volume")
		if !ok || volume < 0 || volume > 1 {
			return nil, ErrInvalidCommandPayload
		}
		out["volume"] = volume
	case "play", "pause", "next", "previous":
		// These commands are pure controller intents; server metadata is added below.
	case "queue:set":
		// Server-owned queue intent. Payload survives normalization — the queue
		// validator reads trackIds / queueRevision / etc. from it below in
		// applyQueueSetIntent. We intentionally do NOT normalize (strip) it
		// here because unknown nested fields are part of the intent's business
		// data, not noise.
		if payload == nil {
			return nil, ErrQueueEmpty
		}
		return payload, nil
	default:
		return nil, ErrUnknownCommand
	}
	return out, nil
}

func ensureCommandPayloadSize(payload map[string]interface{}, maxBytes int) error {
	if len(payload) == 0 {
		return nil
	}
	enc, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if len(enc) > maxBytes {
		return ErrPayloadTooLarge
	}
	return nil
}

func commandNowPlayingPayload(payload map[string]interface{}) *NowPlaying {
	if payload == nil {
		return nil
	}
	raw, ok := payload["nowPlaying"]
	if !ok || raw == nil {
		return nil
	}
	enc, err := json.Marshal(raw)
	if err != nil {
		return nil
	}
	var np NowPlaying
	if err := json.Unmarshal(enc, &np); err != nil {
		return nil
	}
	if strings.TrimSpace(np.TrackID) == "" {
		return nil
	}
	return &np
}

func numberFromPayload(payload map[string]interface{}, key string) (float64, bool) {
	if payload == nil {
		return 0, false
	}
	raw, ok := payload[key]
	if !ok {
		return 0, false
	}
	var v float64
	switch n := raw.(type) {
	case float64:
		v = n
	case float32:
		v = float64(n)
	case int:
		v = float64(n)
	case int64:
		v = float64(n)
	case json.Number:
		parsed, err := n.Float64()
		if err != nil {
			return 0, false
		}
		v = parsed
	default:
		return 0, false
	}
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0, false
	}
	return v, true
}

func rejectMetricReason(reason string) string {
	reason = strings.TrimSpace(strings.ToLower(reason))
	if reason == "" {
		return "unknown"
	}
	if len(reason) > 64 {
		return reason[:64]
	}
	return reason
}

func normalizeClientEventAtMs(v, nowMs int64) (int64, bool) {
	if v <= 0 {
		return nowMs, false
	}
	if v > nowMs+maxClientNowPlayingFutureSkewMs {
		return nowMs, false
	}
	if nowMs-v > maxClientNowPlayingEventAgeMs {
		return nowMs, false
	}
	return v, true
}

func isStaleNowPlayingUpdate(prev *NowPlaying, did string, clientEventAtMs, clientSeq int64) bool {
	if prev == nil || prev.DeviceID != did {
		return false
	}
	if prev.ClientEventAtMs > 0 && clientEventAtMs > 0 {
		if clientEventAtMs < prev.ClientEventAtMs {
			return true
		}
		if clientEventAtMs > prev.ClientEventAtMs {
			return false
		}
	}
	if prev.ClientSeq > 0 && clientSeq > 0 && clientSeq <= prev.ClientSeq {
		return true
	}
	return false
}

func parseInt64(s string) int64 {
	if s == "" {
		return 0
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0
	}
	return n
}

func strPtr(s string) *string { return &s }

func optionalString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// cheap in-place sorts — registry is called rarely enough that an O(n log n)
// on 30 elements dominates nothing.
func sortByLastSeenDesc(devs []*Device) {
	for i := 1; i < len(devs); i++ {
		for j := i; j > 0 && devs[j-1].LastSeenAt < devs[j].LastSeenAt; j-- {
			devs[j-1], devs[j] = devs[j], devs[j-1]
		}
	}
}
func sortByLastSeenAsc(devs []*Device) {
	for i := 1; i < len(devs); i++ {
		for j := i; j > 0 && devs[j-1].LastSeenAt > devs[j].LastSeenAt; j-- {
			devs[j-1], devs[j] = devs[j], devs[j-1]
		}
	}
}

// =============================================================================
// Server-owned queue (TrackSync 2026-08-10)
// =============================================================================

const (
	defaultQueueLimit = 500
	advanceNext      = 1
	advancePrevious  = -1
)

var (
	queueAllowedRepeat = map[string]struct{}{
		"off": {}, "all": {}, "one": {},
	}
)

// Errors for queue intent application (returned via SendCommand to caller).
var (
	ErrQueueTooLarge = errors.New("queue too large")
	ErrQueueBadIndex = errors.New("queue index out of range")
	ErrQueueStaleRev = errors.New("queue revision stale")
	ErrQueueEmpty    = errors.New("queue empty")
)

// applyQueueSetIntent validates and replaces the authoritative queue
// atomically under a CAS against the queue key.
//
// Rules:
//   - Max 500 trackIds (cost bound on cache entry + transport).
//   - Every trackId must pass isValidTrackId (cheap defense; the upstream
//     catalog rejects invalid ids later anyway).
//   - Index must be in range [0, len(trackIds)); sanitized with clamping.
//   - repeat is "off" | "all" | "one"; shuffle boolean; shuffleOrder generated
//     only for shuffle=true (otherwise ignored).
//   - Revision check optional: if payload.queueRevision > 0 and it differs
//     from the current queue revision → caller has a stale view; reject with
//     QUEUE_CONFLICT so the client can re-fetch and try again (Caller always
//     wins on later valid data — queue mutations from distinct controllers
//     are *intended* to be last-write-wins, not merged).
func (r *Registry) applyQueueSetIntent(ctx context.Context, uid, activeID, fromDeviceID string, payload map[string]interface{}) error {
	if payload == nil {
		return ErrQueueEmpty
	}

	rawTrackIDs, ok := payload["trackIds"]
	if !ok {
		return ErrQueueEmpty
	}
	trackIDsAny, ok := rawTrackIDs.([]interface{})
	if !ok {
		return ErrQueueEmpty
	}
	if len(trackIDsAny) == 0 {
		return ErrQueueEmpty
	}
	if len(trackIDsAny) > defaultQueueLimit {
		return ErrQueueTooLarge
	}

	trackIDs := make([]string, 0, len(trackIDsAny))
	for _, v := range trackIDsAny {
		s, _ := v.(string)
		s = strings.TrimSpace(s)
		if !isValidTrackId(s) {
			return ErrQueueEmpty
		}
		trackIDs = append(trackIDs, s)
	}

	idx := 0
	if v, ok := payload["index"].(float64); ok {
		idx = int(v)
	} else if v, ok := payload["index"].(int); ok {
		idx = v
	}
	if idx < 0 {
		idx = 0
	}
	if idx >= len(trackIDs) {
		return ErrQueueBadIndex
	}

	repeat := "off"
	if s, ok := payload["repeat"].(string); ok {
		s = strings.ToLower(strings.TrimSpace(s))
		if _, allowed := queueAllowedRepeat[s]; allowed {
			repeat = s
		}
	}

	shuffle := false
	if v, ok := payload["shuffle"].(bool); ok {
		shuffle = v
	}

	queueSource := strings.TrimSpace(fromString(payload, "queueSource"))
	queueName := strings.TrimSpace(fromString(payload, "queueName"))
	// Revision fencing: callers MAY pass queueRevision > 0 as "I know the queue
	// is at rev N, apply only if still true". We accept queueRevision as
	// number (json.Unmarshal's default float64) or int64 (dev).
	expectRev := int64(0)
	switch v := payload["queueRevision"].(type) {
	case float64:
		if v > 0 {
			expectRev = int64(v)
		}
	case int64:
		if v > 0 {
			expectRev = v
		}
	case int:
		if v > 0 {
			expectRev = int64(v)
		}
	}
	r.log.Debug("queue:set revision guard",
		slog.String("userId", uid),
		slog.Int64("expectRev", expectRev),
		slog.Bool("emptyQueue", len(trackIDs) == 0)) // trackIDs may be empty after sanitize)

	nowMs := time.Now().UnixMilli()
	next := &PlaybackQueue{
		TrackIDs:       trackIDs,
		Index:          idx,
		Repeat:         repeat,
		Shuffle:        shuffle,
		QueueSource:    truncate(queueSource, 32),
		QueueName:      truncate(queueName, 120),
		UpdatedAtMs:    nowMs,
		UpdatedByDevice: fromDeviceID,
	}
	if shuffle {
		next.ShuffleOrder = buildShuffleOrder(len(trackIDs))
	}

	// Revision fencing: read the current revision *before* starting the
	// transaction so we can fail fast without needing to rely on the tx-level
	// error propagation (Redis tx wrapping can mask non-tx errors).
	r.log.Debug("queue:set-guard",
		slog.String("userId", uid),
		slog.String("key", r.keyQueue(uid)),
		slog.Int64("expectRev", expectRev))
	rawCur, readErr := r.rdb.Get(ctx, r.keyQueue(uid)).Result()
	if readErr != nil && !errors.Is(readErr, redis.Nil) {
		return readErr
	}
	curRev := int64(0)
	if readErr == nil && rawCur != "" {
		var prev PlaybackQueue
		if jerr := json.Unmarshal([]byte(rawCur), &prev); jerr == nil {
			curRev = prev.Revision
		}
	}
	if expectRev > 0 {
		r.log.Debug("queue:set-fence-eval",
			slog.String("userId", uid),
			slog.Int64("expectRev", expectRev),
			slog.Int64("curRev", curRev),
		)
		if expectRev != curRev {
			return ErrQueueStaleRev
		}
	}

	// Transactional write under WATCH so that concurrent writes (two phones)
	// fail with QUEUE_CONFLICT instead of resulting in split brain.
	for attempt := 0; attempt < 3; attempt++ {
		err := r.rdb.Watch(ctx, func(tx *redis.Tx) error {
			// We already validated the revision above; just need to ensure no
			// one else flipped it between our fast-path check and this commit.
			raw, err := tx.Get(ctx, r.keyQueue(uid)).Result()
			if err != nil && !errors.Is(err, redis.Nil) {
				return err
			}
			currentRev := int64(0)
			if err == nil && raw != "" {
				var prev PlaybackQueue
				if jerr := json.Unmarshal([]byte(raw), &prev); jerr == nil {
					currentRev = prev.Revision
				}
			}
			if expectRev > 0 && currentRev > 0 && expectRev != currentRev {
				return ErrQueueStaleRev
			}
			next.Revision = currentRev + 1
			if next.Revision <= 0 {
				next.Revision = 1
			}
			enc, jerr := json.Marshal(next)
			if jerr != nil {
				return jerr
			}
			pipe := tx.TxPipeline()
			pipe.Set(ctx, r.keyQueue(uid), enc, r.cfg.Device.NowPlayingTTL)
			_, err = pipe.Exec(ctx)
			return err
		}, r.keyQueue(uid))
		if err == nil {
			r.log.Debug("queue:set applied",
				slog.String("userId", uid),
				slog.Int("trackCount", len(trackIDs)),
				slog.Int("index", idx),
				slog.Int64("revision", next.Revision),
			)
			// Piggyback queue update into nowPlaying so subscribers see the
			// indexed change on the next player_state tick (zero extra fetches).
			r.syncNowPlayingQueueContext(ctx, uid, activeID, next)
			r.publish(ctx, uid, Event{Type: "queue:update", At: nowMs})
			return nil
		}
		if errors.Is(err, redis.TxFailedErr) {
			continue
		}
		return err
	}
	return errors.New("cas retry budget exhausted")
}

// applyQueueAdvanceIntent shifts the current index by delta (+1/-1) respecting
// repeat/shuffle rules, and synchronously writes the new trackId into
// nowPlaying so all devices see the new core-play state immediately (without
// waiting for the active device's player-graded np:update).
//
// This is what removes: «повторяю next через 2s delay». Backend acts
// immediately, UI sees change on the SAME RTT.
func (r *Registry) applyQueueAdvanceIntent(ctx context.Context, uid, activeID string, next bool) error {
	// Multi-key CAS: queue + nowPlaying must be updated together.
	queueKey := r.keyQueue(uid)
	npKey := r.keyNowPlaying(uid)

	for attempt := 0; attempt < 3; attempt++ {
		err := r.rdb.Watch(ctx, func(tx *redis.Tx) error {
			rawQueue, err := tx.Get(ctx, queueKey).Result()
			if err != nil {
				return ErrQueueEmpty
			}
			var queue PlaybackQueue
			if err := json.Unmarshal([]byte(rawQueue), &queue); err != nil {
				return ErrQueueEmpty
			}
			if len(queue.TrackIDs) == 0 {
				return ErrQueueEmpty
			}

			// Compute next index (repeat logic).
			currentIdx := queue.Index
			if currentIdx < 0 || currentIdx >= len(queue.TrackIDs) {
				currentIdx = 0
			}
			var newIdx int
			if queue.Repeat == "one" {
				newIdx = currentIdx
			} else if next {
				newIdx = currentIdx + 1
				if newIdx >= len(queue.TrackIDs) {
					if queue.Repeat == "all" {
						newIdx = 0
					} else {
						newIdx = len(queue.TrackIDs) - 1
					}
				}
			} else {
				newIdx = currentIdx - 1
				if newIdx < 0 {
					if queue.Repeat == "all" {
						newIdx = len(queue.TrackIDs) - 1
					} else {
						newIdx = 0
					}
				}
			}
			if queue.Shuffle && len(queue.ShuffleOrder) == len(queue.TrackIDs) {
				if pos := indexOfInt(queue.ShuffleOrder, currentIdx); pos >= 0 {
					var np int
					if next {
						np = (pos + 1) % len(queue.ShuffleOrder)
					} else {
						np = (pos - 1 + len(queue.ShuffleOrder)) % len(queue.ShuffleOrder)
					}
					newIdx = queue.ShuffleOrder[np]
				}
			}
			newTrackID := queue.TrackIDs[newIdx]

			// Read + mutate nowPlaying atomically (we're inside WATCH).
			rawNP, err := tx.Get(ctx, npKey).Result()
			if err != nil {
				return ErrQueueEmpty
			}
			var np NowPlaying
			if err := json.Unmarshal([]byte(rawNP), &np); err != nil {
				return ErrQueueEmpty
			}
			if np.DeviceID != activeID {
				return ErrNotActiveDevice
			}

			nowMs := time.Now().UnixMilli()
			np.TrackID = newTrackID
			np.StateRevision++
			if np.StateRevision <= 0 {
				np.StateRevision = 1
			}
			np.QueueIndex = newIdx
			np.QueueRevision = queue.Revision + 1
			np.QueueSource = queue.QueueSource
			np.QueueName = queue.QueueName
			np.UpdatedAtMs = nowMs
			np.ClientEventAtMs = nowMs
			// Position starts at 0 on track change (Spotify semantics).
			np.PositionSec = 0

			enc, jerr := json.Marshal(np)
			if jerr != nil {
				return jerr
			}

			// Bump queue revision too so each mutation is distinct (replay
			// attacks via stale expectedRev).
			queue.Revision++
			queue.Index = newIdx
			queue.UpdatedAtMs = nowMs
			encQueue, jerr := json.Marshal(queue)
			if jerr != nil {
				return jerr
			}

			pipe := tx.TxPipeline()
			pipe.Set(ctx, npKey, enc, r.cfg.Device.NowPlayingTTL)
			pipe.Set(ctx, queueKey, encQueue, r.cfg.Device.NowPlayingTTL)
			_, err = pipe.Exec(ctx)
			return err
		}, queueKey, npKey)
		if err == nil {
			r.publish(ctx, uid, Event{Type: "np:update", At: time.Now().UnixMilli()})
			return nil
		}
		if errors.Is(err, redis.TxFailedErr) {
			continue
		}
		return err
	}
	return errors.New("cas retry budget exhausted")
}

// syncNowPlayingQueueContext updates nowPlaying.Queue* fields from the queue
// without touching position or isPlaying. Used after queue:set.
func (r *Registry) syncNowPlayingQueueContext(ctx context.Context, uid, activeID string, queue *PlaybackQueue) {
	if queue == nil {
		return
	}
	raw, err := r.rdb.Get(ctx, r.keyNowPlaying(uid)).Result()
	if err != nil {
		return
	}
	var np NowPlaying
	if err := json.Unmarshal([]byte(raw), &np); err != nil {
		return
	}
	np.QueueRevision = queue.Revision
	np.QueueIndex = queue.Index
	np.QueueSource = queue.QueueSource
	np.QueueName = queue.QueueName
	np.UpdatedAtMs = time.Now().UnixMilli()
	np.StateRevision++
	if np.StateRevision <= 0 {
		np.StateRevision = 1
	}
	// If queue index points at a different track AND queue is empty-vs-initial,
	// do NOT switch trackId automatically — client will send a new city from |next.
	enc, err := json.Marshal(&np)
	if err != nil {
		return
	}
	_ = r.rdb.Set(ctx, r.keyNowPlaying(uid), enc, r.cfg.Device.NowPlayingTTL).Err()
}

// buildShuffleOrder generates a random permutation of [0, n). Not
// cryptographically strong — only used for playback UX, not auth.
func buildShuffleOrder(n int) []int {
	if n <= 0 {
		return nil
	}
	out := make([]int, n)
	for i := range out {
		out[i] = i
	}
	for i := n - 1; i > 0; i-- {
		j := int(time.Now().UnixNano() % int64(i+1))
		out[i], out[j] = out[j], out[i]
	}
	return out
}

func indexOfInt(arr []int, needle int) int {
	for i, v := range arr {
		if v == needle {
			return i
		}
	}
	return -1
}

func fromString(m map[string]interface{}, key string) string {
	if m == nil {
		return ""
	}
	v, ok := m[key]
	if !ok {
		return ""
	}
	s, _ := v.(string)
	return s
}
