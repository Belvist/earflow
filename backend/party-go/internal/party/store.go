package party

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/go-redis/redis/v8"
)

// Store is Redis + Lua (single-writer) party state.
type Store struct {
	r               *redis.Client
	SessionTTL      time.Duration
	MaxParticipants int
}

func NewStore(r *redis.Client, sessionTTL time.Duration, maxParticipants int) *Store {
	if maxParticipants <= 0 {
		maxParticipants = 50
	}
	return &Store{r: r, SessionTTL: sessionTTL, MaxParticipants: maxParticipants}
}

// CreatePartyIfNotExists sets doc with NX.
func (s *Store) CreatePartyIfNotExists(ctx context.Context, doc *PartyDoc) (bool, error) {
	if doc == nil {
		return false, errors.New("nil doc")
	}
	raw, err := json.Marshal(doc)
	if err != nil {
		return false, err
	}
	key := KeyDoc(doc.ID)
	ok, err := s.r.SetNX(ctx, key, raw, s.SessionTTL).Result()
	if err != nil {
		return false, err
	}
	return ok, nil
}

func (s *Store) GetParty(ctx context.Context, partyID string) (*PartyDoc, error) {
	raw, err := s.r.Get(ctx, KeyDoc(partyID)).Bytes()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var d PartyDoc
	if err := json.Unmarshal(raw, &d); err != nil {
		return nil, err
	}
	return &d, nil
}

// TouchParty extends the party document TTL without reading or rewriting the
// full document. Gateways use this for throttled connection keepalive so many
// idle listeners do not generate full Redis/Lua snapshots every few seconds.
func (s *Store) TouchParty(ctx context.Context, partyID string) (bool, error) {
	partyID = strings.TrimSpace(partyID)
	if partyID == "" {
		return false, nil
	}
	return s.r.Expire(ctx, KeyDoc(partyID), s.SessionTTL).Result()
}

// SAddHostIndex adds party id to user's hosted set.
func (s *Store) SAddHostIndex(ctx context.Context, userID, partyID string) error {
	return s.r.SAdd(ctx, KeyUserHosted(userID), partyID).Err()
}

// SRemHostIndex removes.
func (s *Store) SRemHostIndex(ctx context.Context, userID, partyID string) error {
	return s.r.SRem(ctx, KeyUserHosted(userID), partyID).Err()
}

// HostedParties returns all party ids for host.
func (s *Store) HostedParties(ctx context.Context, userID string) ([]string, error) {
	return s.r.SMembers(ctx, KeyUserHosted(userID)).Result()
}

type ApplyOutcome struct {
	OK    bool
	Code  string
	Doc   *PartyDoc
	Event json.RawMessage
	Raw   string
}

// ApplyCommand runs the Lua script (atomic).
func (s *Store) ApplyCommand(ctx context.Context, cmd any) (*ApplyOutcome, error) {
	b, err := json.Marshal(cmd)
	if err != nil {
		return nil, err
	}
	// extract partyId for key
	m := make(map[string]any)
	_ = json.Unmarshal(b, &m)
	partyID, _ := m["partyId"].(string)
	if partyID == "" {
		return nil, errors.New("missing partyId in command")
	}
	key := KeyDoc(partyID)
	now := time.Now().UnixMilli()
	raw, err := s.r.Eval(ctx, scriptApply, []string{key},
		fmt.Sprintf("%d", now),
		fmt.Sprintf("%d", int(s.SessionTTL.Seconds())),
		string(b),
	).Result()
	if err != nil {
		return nil, err
	}
	rstr, ok := raw.(string)
	if !ok || rstr == "" {
		return &ApplyOutcome{OK: false, Code: "STORE_ERROR", Raw: ""}, nil
	}
	var parsed struct {
		OK    bool            `json:"ok"`
		Code  string          `json:"code"`
		Doc   json.RawMessage `json:"doc"`
		Event json.RawMessage `json:"event"`
	}
	if err := json.Unmarshal([]byte(rstr), &parsed); err != nil {
		return &ApplyOutcome{OK: false, Code: "STORE_ERROR", Raw: rstr}, nil
	}
	if !parsed.OK {
		return &ApplyOutcome{OK: false, Code: parsed.Code, Raw: rstr}, nil
	}
	var doc PartyDoc
	if len(parsed.Doc) > 0 {
		_ = json.Unmarshal(parsed.Doc, &doc)
	}
	return &ApplyOutcome{OK: true, Doc: &doc, Event: parsed.Event, Raw: rstr}, nil
}

// FindInviteCodeForParty locates the active invite code for a party (keys mp:party:v2:{id}:invite:{code}).
// Used when CreateInvite returns false (idempotent re-request from client) or recovery.
func (s *Store) FindInviteCodeForParty(ctx context.Context, partyID string) (string, error) {
	partyID = strings.TrimSpace(partyID)
	if partyID == "" {
		return "", nil
	}
	pat := "mp:party:v2:" + partyID + ":invite:*"
	var cur uint64
	for {
		keys, next, err := s.r.Scan(ctx, cur, pat, 64).Result()
		if err != nil {
			return "", err
		}
		const needle = ":invite:"
		for _, k := range keys {
			i := strings.LastIndex(k, needle)
			if i < 0 {
				continue
			}
			code := k[i+len(needle):]
			if code != "" {
				return code, nil
			}
		}
		if next == 0 {
			break
		}
		cur = next
	}
	return "", nil
}

// normalizeInviteKeySuffix сопоставляет XXXX-XXXX в Redis (A-Z, 0-9) независимо от ввода.
func normalizeInviteKeySuffix(code string) string {
	var b strings.Builder
	for _, r := range code {
		switch {
		case r >= 'a' && r <= 'z':
			b.WriteRune(r - ('a' - 'A'))
		case (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
		}
	}
	s := b.String()
	if len(s) == 8 {
		return s[:4] + "-" + s[4:]
	}
	return strings.TrimSpace(code)
}

// inviteCodeIndexForms: оба варианта глобального индекса (с дефисом и 8 A-Z0-9) — join часто вводит без «-».
func inviteCodeIndexForms(canonical8Hyphen string) []string {
	c := strings.TrimSpace(strings.ToUpper(canonical8Hyphen))
	if c == "" {
		return nil
	}
	var b strings.Builder
	for _, r := range c {
		if r >= '0' && r <= '9' || r >= 'A' && r <= 'Z' {
			b.WriteRune(r)
		}
	}
	s := b.String()
	if len(s) != 8 {
		return []string{c}
	}
	h := s[:4] + "-" + s[4:]
	if h == s {
		return []string{h}
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, 2)
	for _, v := range []string{h, s} {
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
}

// DeleteInviteKeysForParty removes per-party invite keys and the global
// mp:party:v2:invitecode:* index entries. After the party document is deleted
// (end / host leave), these keys would otherwise outlive the doc and cause
// join-by-code to resolve a partyId with no document (PARTY_NOT_FOUND).
func (s *Store) DeleteInviteKeysForParty(ctx context.Context, partyID string) error {
	partyID = strings.TrimSpace(partyID)
	if partyID == "" {
		return nil
	}
	pat := "mp:party:v2:" + partyID + ":invite:*"
	var cur uint64
	for {
		keys, next, err := s.r.Scan(ctx, cur, pat, 64).Result()
		if err != nil {
			return err
		}
		const needle = ":invite:"
		for _, k := range keys {
			i := strings.LastIndex(k, needle)
			if i < 0 {
				continue
			}
			code := k[i+len(needle):]
			if code == "" {
				continue
			}
			forms := inviteCodeIndexForms(code)
			pipe := s.r.TxPipeline()
			pipe.Del(ctx, k)
			for _, f := range forms {
				pipe.Del(ctx, KeyInviteByCode(f))
			}
			if _, err := pipe.Exec(ctx); err != nil {
				return err
			}
		}
		if next == 0 {
			break
		}
		cur = next
	}
	return nil
}

// CreateInvite sets invite key and code→partyId index.
// If the reverse index write fails, the per-party invite key is removed so the state stays consistent
// (otherwise joinByCode would never resolve — PartyIDByCode only checks the index).
func (s *Store) CreateInvite(ctx context.Context, partyID, code string, ttl time.Duration) (bool, error) {
	partyID = strings.TrimSpace(partyID)
	code = strings.TrimSpace(code)
	if partyID == "" || code == "" {
		return false, nil
	}
	keySuffix := normalizeInviteKeySuffix(code)
	inv := KeyInvite(partyID, keySuffix)
	nx, err := s.r.SetNX(ctx, inv, "1", ttl).Result()
	if err != nil {
		return false, err
	}
	if !nx {
		return false, nil
	}
	forms := inviteCodeIndexForms(keySuffix)
	if len(forms) == 0 {
		_ = s.r.Del(ctx, inv).Err()
		return false, nil
	}
	pipe := s.r.TxPipeline()
	for _, f := range forms {
		pipe.Set(ctx, KeyInviteByCode(f), partyID, ttl)
	}
	_, err = pipe.Exec(ctx)
	if err != nil {
		_ = s.r.Del(ctx, inv).Err()
		return false, err
	}
	return true, nil
}

// RefreshInvite keeps an existing per-party invite and its reverse lookup alive.
// It is used when a host opens/copies the invite again: the visible code must
// continue to resolve through join-by-code for the same TTL window.
func (s *Store) RefreshInvite(ctx context.Context, partyID, code string, ttl time.Duration) error {
	partyID = strings.TrimSpace(partyID)
	code = strings.TrimSpace(code)
	if partyID == "" || code == "" {
		return nil
	}
	if ttl <= 0 {
		return nil
	}
	keySuf := normalizeInviteKeySuffix(code)
	inv := KeyInvite(partyID, keySuf)
	exists, err := s.r.Exists(ctx, inv).Result()
	if err != nil {
		return err
	}
	if exists == 0 {
		return nil
	}
	forms := inviteCodeIndexForms(keySuf)
	pipe := s.r.TxPipeline()
	pipe.Expire(ctx, inv, ttl)
	for _, f := range forms {
		pipe.Set(ctx, KeyInviteByCode(f), partyID, ttl)
	}
	_, err = pipe.Exec(ctx)
	return err
}

// RepairInviteByCodeIndex sets mp:party:v2:invitecode:{code} when the per-party invite key is still "1"
// but the reverse index is missing (e.g. Set failed in a past CreateInvite after SetNX). Uses the same
// TTL as a fresh index would (passed from the handler).
func (s *Store) RepairInviteByCodeIndex(ctx context.Context, partyID, code string, indexTTL time.Duration) error {
	partyID = strings.TrimSpace(partyID)
	code = strings.TrimSpace(code)
	if partyID == "" || code == "" {
		return nil
	}
	keySuf := normalizeInviteKeySuffix(code)
	inv := KeyInvite(partyID, keySuf)
	v, err := s.r.Get(ctx, inv).Result()
	if err == redis.Nil {
		return nil
	}
	if err != nil {
		return err
	}
	if v != "1" {
		return nil
	}
	ttl := indexTTL
	if remaining, ttlErr := s.r.TTL(ctx, inv).Result(); ttlErr == nil && remaining > 0 {
		ttl = remaining
	}
	if ttl <= 0 {
		ttl = time.Hour
	}
	forms := inviteCodeIndexForms(keySuf)
	pipe := s.r.TxPipeline()
	for _, f := range forms {
		pipe.Set(ctx, KeyInviteByCode(f), partyID, ttl)
	}
	_, err = pipe.Exec(ctx)
	return err
}

// PartyIDByCode resolves global invite code.
func (s *Store) PartyIDByCode(ctx context.Context, code string) (string, error) {
	v, err := s.r.Get(ctx, KeyInviteByCode(code)).Result()
	if err == redis.Nil {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return v, nil
}

// PartyIDByInviteCodeFallback resolves invite code by scanning per-party invite
// keys. It is intentionally only a fallback for missing reverse indexes; normal
// joins use O(1) PartyIDByCode.
func (s *Store) PartyIDByInviteCodeFallback(ctx context.Context, code string) (string, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return "", nil
	}
	needleForms := map[string]struct{}{}
	needleForms[code] = struct{}{}
	norm := normalizeInviteKeySuffix(code)
	if norm != "" {
		needleForms[norm] = struct{}{}
	}
	prefix := "mp:party:v2:"
	var cur uint64
	for n := range needleForms {
		suffix := ":invite:" + n
		pat := prefix + "*" + suffix
		cur = 0
		for {
			keys, next, err := s.r.Scan(ctx, cur, pat, 128).Result()
			if err != nil {
				return "", err
			}
			for _, k := range keys {
				if !strings.HasPrefix(k, prefix) || !strings.HasSuffix(k, suffix) {
					continue
				}
				pid := strings.TrimSuffix(strings.TrimPrefix(k, prefix), suffix)
				if pid != "" {
					return pid, nil
				}
			}
			if next == 0 {
				break
			}
			cur = next
		}
	}
	return "", nil
}

func (st *Store) CheckInvite(ctx context.Context, partyID, code string) (bool, error) {
	candidates := []string{code, normalizeInviteKeySuffix(code)}
	seen := map[string]struct{}{}
	for _, c := range candidates {
		if c == "" {
			continue
		}
		if _, ok := seen[c]; ok {
			continue
		}
		seen[c] = struct{}{}
		v, err := st.r.Get(ctx, KeyInvite(partyID, c)).Result()
		if err == redis.Nil {
			continue
		}
		if err != nil {
			return false, err
		}
		return v == "1", nil
	}
	return false, nil
}
