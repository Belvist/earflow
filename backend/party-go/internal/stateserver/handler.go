package stateserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/earflow/music-platform/party-go/internal/invite"
	"github.com/earflow/music-platform/party-go/internal/party"
	"github.com/earflow/music-platform/party-go/internal/wstoken"
	"github.com/go-chi/chi/v5"
	"github.com/oklog/ulid/v2"
)

// Handler serves REST. Trusts X-User-Id from api-gateway.
type Handler struct {
	Store     *party.Store
	Cfg       Config
	JWTSecret string
}

func (h *Handler) userID(r *http.Request) string { return strings.TrimSpace(r.Header.Get("X-User-Id")) }
func (h *Handler) userName(r *http.Request) string {
	v := strings.TrimSpace(r.Header.Get("X-User-Name"))
	if v == "" {
		return "User"
	}
	return v
}

// Register mounts routes. Register static paths before /{id}.
func (h *Handler) Register(r chi.Router) {
	r.Get("/health", h.Health)
	r.Get("/metrics", h.Metrics)
	r.Get("/api/party/user/active", h.getUserActive)
	r.Delete("/api/party/user/cleanup", h.userCleanup)
	r.Post("/api/party/join/code", h.joinByCode)
	r.Get("/api/party/join/{token}", h.joinByLink)
	r.Post("/api/party", h.create)
	r.Post("/api/party/v2/create", h.create) // alias
	r.Get("/api/party/{partyId}/ws-ticket", h.wsTicket)
	r.Post("/api/party/{partyId}/invite", h.createInvite)
	r.Post("/api/party/{partyId}/join", h.join)
	r.Post("/api/party/{partyId}/leave", h.leave)
	r.Delete("/api/party/{partyId}", h.end)
	r.Get("/api/party/{partyId}", h.get)
}

func (h *Handler) Health(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("content-type", "application/json")
	_, _ = w.Write([]byte(`{"ok":true}`))
}

func (h *Handler) Metrics(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("content-type", "text/plain; version=0.0.4; charset=utf-8")
	_, _ = fmt.Fprint(w, "# HELP party_state_up State service liveness.\n# TYPE party_state_up gauge\nparty_state_up 1\n")
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	uid := h.userID(r)
	if uid == "" {
		httpJSON(w, http.StatusUnauthorized, map[string]any{"error": "Authentication required", "code": "NO_SESSION"})
		return
	}
	var body struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		IsPrivate   *bool  `json:"isPrivate"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	title := strings.TrimSpace(body.Title)
	if title == "" {
		title = h.userName(r) + "'s Party"
	}
	ip := true
	if body.IsPrivate != nil {
		ip = *body.IsPrivate
	}
	ctx := r.Context()
	list, _ := h.Store.HostedParties(ctx, uid)
	if len(list) >= h.Cfg.MaxPartiesPerUser {
		httpJSON(w, http.StatusTooManyRequests, map[string]any{
			"error": "Maximum number of active parties reached", "code": "MAX_PARTIES_EXCEEDED",
			"maxParties": h.Cfg.MaxPartiesPerUser,
		})
		return
	}
	now := time.Now().UnixMilli()
	id := ulid.Make().String()
	desc := strings.TrimSpace(body.Description)
	if len(desc) > 500 {
		desc = desc[:500]
	}
	doc := &party.PartyDoc{
		V:               1,
		ID:              id,
		Title:           title,
		Description:     desc,
		IsPrivate:       ip,
		HostID:          uid,
		HostName:        h.userName(r),
		CreatedAtMs:     now,
		Rev:             0,
		Permissions:     party.DefaultPerms,
		Playback:        party.PlaybackState{PositionMs: 0, PositionUpdatedAtMs: now},
		Participants:    map[string]party.Participant{uid: {UserID: uid, Username: h.userName(r), IsHost: true, JoinedAtMs: now}},
		Queue:           []party.QueueItem{},
		MaxParticipants: h.Cfg.MaxParticipants,
	}
	tok, err := h.issueWSToken(ctx, id, uid)
	if err != nil {
		httpJSON(w, http.StatusInternalServerError, map[string]any{"error": "Token failed", "code": "TOKEN_FAILED"})
		return
	}
	ok, err := h.Store.CreatePartyIfNotExists(ctx, doc)
	if err != nil {
		httpJSON(w, http.StatusInternalServerError, map[string]any{"error": "Server error", "code": "STORE_ERROR"})
		return
	}
	if !ok {
		httpJSON(w, http.StatusConflict, map[string]any{"error": "Party already exists", "code": "ALREADY_EXISTS"})
		return
	}
	if err := h.Store.SAddHostIndex(ctx, uid, id); err != nil {
		_, _ = h.Store.ApplyCommand(ctx, map[string]any{"type": "end", "partyId": id, "userId": uid})
		_ = h.Store.DeleteInviteKeysForParty(ctx, id)
		httpJSON(w, http.StatusInternalServerError, map[string]any{"error": "Server error", "code": "STORE_ERROR"})
		return
	}
	inv, invErr := h.materializeInvite(ctx, id, h.Cfg.InviteTTLKey)
	if invErr != nil {
		log.Printf("party create: materialize invite partyId=%s: %v", id, invErr)
		_, _ = h.Store.ApplyCommand(ctx, map[string]any{"type": "end", "partyId": id, "userId": uid})
		_ = h.Store.DeleteInviteKeysForParty(ctx, id)
		_ = h.Store.SRemHostIndex(ctx, uid, id)
		httpJSON(w, http.StatusInternalServerError, map[string]any{"error": "Invite failed", "code": "INVITE_CREATE_FAILED"})
		return
	}
	out := map[string]any{
		"success": true,
		"party": map[string]any{
			"id": id, "title": doc.Title, "description": doc.Description, "isPrivate": doc.IsPrivate,
			"maxParticipants": doc.MaxParticipants, "participantCount": 1, "hostId": uid, "hostName": doc.HostName,
			"createdAt": time.UnixMilli(now).UTC().Format(time.RFC3339),
		},
		"wsUrl":   "/ws/v2",
		"wsToken": tok,
		"ticket":  tok,
	}
	if inv != nil {
		out["invite"] = inv
		if c, ok := inv["code"].(string); ok {
			out["inviteCode"] = c
		}
	}
	httpJSON(w, http.StatusCreated, out)
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	uid := h.userID(r)
	if uid == "" {
		httpJSON(w, http.StatusUnauthorized, map[string]any{"error": "Authentication required", "code": "NO_SESSION"})
		return
	}
	pid := strings.TrimSpace(chi.URLParam(r, "partyId"))
	if pid == "" {
		httpJSON(w, http.StatusBadRequest, map[string]any{"error": "Invalid party", "code": "VALIDATION_ERROR"})
		return
	}
	ctx := r.Context()
	doc, err := h.Store.GetParty(ctx, pid)
	if err != nil {
		httpJSON(w, http.StatusInternalServerError, map[string]any{"error": "Server error"})
		return
	}
	if doc == nil {
		httpJSON(w, http.StatusNotFound, map[string]any{"error": "Party not found", "code": "PARTY_NOT_FOUND"})
		return
	}
	out := buildGetParty(doc, uid)
	_, isParticipant := doc.Participants[uid]
	httpJSON(w, http.StatusOK, map[string]any{
		"party":         out["party"],
		"state":         out["state"],
		"queue":         out["queue"],
		"participants":  out["participants"],
		"permissions":   out["permissions"],
		"isParticipant": isParticipant,
		"isHost":        out["isHost"],
	})
}

func (h *Handler) join(w http.ResponseWriter, r *http.Request) {
	uid := h.userID(r)
	if uid == "" {
		httpJSON(w, http.StatusUnauthorized, map[string]any{"error": "Authentication required", "code": "NO_SESSION"})
		return
	}
	pid := strings.TrimSpace(chi.URLParam(r, "partyId"))
	var body struct {
		UserName   string  `json:"userName"`
		InviteCode *string `json:"inviteCode"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	u := strings.TrimSpace(body.UserName)
	if u == "" {
		u = h.userName(r)
	}
	ctx := r.Context()
	doc, err := h.Store.GetParty(ctx, pid)
	if err != nil || doc == nil {
		httpJSON(w, http.StatusNotFound, map[string]any{"error": "Party not found", "code": "PARTY_NOT_FOUND"})
		return
	}
	if doc.IsPrivate {
		ic := ""
		if body.InviteCode != nil {
			ic = strings.TrimSpace(*body.InviteCode)
		}
		codes := inviteCodeCandidates(ic)
		if len(codes) == 0 {
			httpJSON(w, http.StatusForbidden, map[string]any{"error": "Invite required", "code": "INVITE_REQUIRED"})
			return
		}
		found := false
		for _, c := range codes {
			ok, _ := h.Store.CheckInvite(ctx, pid, c)
			if ok {
				found = true
				break
			}
		}
		if !found {
			httpJSON(w, http.StatusForbidden, map[string]any{"error": "Invalid invite", "code": "INVITE_INVALID"})
			return
		}
	}
	_, alreadyIn := doc.Participants[uid]
	if len(doc.Participants) >= h.Cfg.MaxParticipants && !alreadyIn {
		httpJSON(w, http.StatusForbidden, map[string]any{"error": "Party is full", "code": "PARTY_FULL"})
		return
	}
	cmd := map[string]any{"type": "join", "partyId": pid, "userId": uid, "username": u}
	apply, e := h.Store.ApplyCommand(ctx, cmd)
	if e != nil || apply == nil || !apply.OK {
		code := "JOIN_FAILED"
		if apply != nil {
			code = apply.Code
		}
		st := http.StatusConflict
		if code == "NOT_FOUND" {
			st = http.StatusNotFound
		}
		httpJSON(w, st, map[string]any{"error": "Join failed", "code": code})
		return
	}
	tok, e := h.issueWSToken(ctx, pid, uid)
	if e != nil {
		httpJSON(w, http.StatusInternalServerError, map[string]any{"error": "Token failed"})
		return
	}
	already := alreadyIn
	httpJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"party": map[string]any{
			"id": apply.Doc.ID, "title": apply.Doc.Title, "hostId": apply.Doc.HostID, "hostName": apply.Doc.HostName,
			"participantCount": len(apply.Doc.Participants),
		},
		"alreadyJoined": already,
		"wsUrl":         "/ws/v2",
		"wsToken":       tok,
		"ticket":        tok, // alias for getPartyWsTicket
	})
}

func (h *Handler) joinByCode(w http.ResponseWriter, r *http.Request) {
	uid := h.userID(r)
	if uid == "" {
		httpJSON(w, http.StatusUnauthorized, map[string]any{"error": "Authentication required", "code": "NO_SESSION"})
		return
	}
	var body struct {
		Code     string `json:"code"`
		UserName string `json:"userName"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	candidates := inviteCodeCandidates(body.Code)
	if len(candidates) == 0 {
		httpJSON(w, http.StatusBadRequest, map[string]any{"error": "Invalid code", "code": "VALIDATION_ERROR"})
		return
	}
	ctx := r.Context()
	pid, matchedCode, err := h.resolvePartyIDByInviteCode(ctx, candidates)
	if err != nil {
		httpJSON(w, http.StatusInternalServerError, map[string]any{"error": "Server error"})
		return
	}
	if pid == "" {
		httpJSON(w, http.StatusNotFound, map[string]any{"error": "Invalid or expired invite code", "code": "INVALID_INVITE_CODE"})
		return
	}
	u := strings.TrimSpace(body.UserName)
	if u == "" {
		u = h.userName(r)
	}
	doc, err := h.Store.GetParty(ctx, pid)
	if err != nil || doc == nil {
		httpJSON(w, http.StatusNotFound, map[string]any{"error": "Party no longer exists or has ended", "code": "PARTY_NOT_FOUND"})
		return
	}
	if doc.IsPrivate {
		found := false
		for _, c := range candidates {
			if c == "" {
				continue
			}
			ok, _ := h.Store.CheckInvite(ctx, pid, c)
			if ok {
				found = true
				break
			}
		}
		if !found {
			httpJSON(w, http.StatusForbidden, map[string]any{"error": "Invalid invite", "code": "INVITE_INVALID"})
			return
		}
	}
	if matchedCode != "" {
		_ = h.Store.RepairInviteByCodeIndex(ctx, pid, matchedCode, h.Cfg.InviteTTLKey)
	}
	_, in := doc.Participants[uid]
	if len(doc.Participants) >= h.Cfg.MaxParticipants && !in {
		httpJSON(w, http.StatusForbidden, map[string]any{"error": "Party is full", "code": "PARTY_FULL"})
		return
	}
	apply, e := h.Store.ApplyCommand(ctx, map[string]any{"type": "join", "partyId": pid, "userId": uid, "username": u})
	if e != nil || apply == nil || !apply.OK {
		if apply != nil && apply.Code == "NOT_FOUND" {
			httpJSON(w, http.StatusNotFound, map[string]any{"error": "Party not found", "code": "PARTY_NOT_FOUND"})
			return
		}
		httpJSON(w, http.StatusConflict, map[string]any{"error": "Join failed", "code": "JOIN_FAILED"})
		return
	}
	tok, e := h.issueWSToken(ctx, pid, uid)
	if e != nil {
		httpJSON(w, http.StatusInternalServerError, map[string]any{"error": "Token failed"})
		return
	}
	httpJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"party": map[string]any{
			"id": apply.Doc.ID, "title": apply.Doc.Title, "hostId": apply.Doc.HostID, "hostName": apply.Doc.HostName,
			"participantCount": len(apply.Doc.Participants),
		},
		"wsUrl":   "/ws/v2",
		"wsToken": tok,
		"ticket":  tok,
	})
}

// joinByLink: GET /api/party/join/{token}
func (h *Handler) joinByLink(w http.ResponseWriter, r *http.Request) {
	uid := h.userID(r)
	if uid == "" {
		httpJSON(w, http.StatusUnauthorized, map[string]any{"error": "Authentication required", "code": "NO_SESSION"})
		return
	}
	token := strings.TrimSpace(chi.URLParam(r, "token"))
	pid, err := invite.VerifyLink(h.JWTSecret, token)
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "INVITE_EXPIRED") {
			httpJSON(w, http.StatusBadRequest, map[string]any{"error": "Invite link has expired", "code": "INVITE_EXPIRED"})
			return
		}
		if strings.Contains(msg, "INVALID_SIGNATURE") {
			httpJSON(w, http.StatusBadRequest, map[string]any{"error": "Invalid invite link", "code": "INVALID_SIGNATURE"})
			return
		}
		httpJSON(w, http.StatusBadRequest, map[string]any{"error": "Invalid invite link", "code": "INVALID_PAYLOAD"})
		return
	}
	ctx := r.Context()
	apply, e := h.Store.ApplyCommand(ctx, map[string]any{
		"type": "join", "partyId": pid, "userId": uid, "username": h.userName(r),
	})
	if e != nil || apply == nil || !apply.OK {
		if apply != nil && apply.Code == "NOT_FOUND" {
			httpJSON(w, http.StatusNotFound, map[string]any{"error": "Party no longer exists", "code": "PARTY_NOT_FOUND"})
			return
		}
		if apply != nil && apply.Code == "PARTY_ENDED" {
			httpJSON(w, http.StatusNotFound, map[string]any{"error": "Party no longer exists", "code": "PARTY_NOT_FOUND"})
			return
		}
		httpJSON(w, http.StatusForbidden, map[string]any{"error": "Party is full", "code": "PARTY_FULL"})
		return
	}
	tk, e := h.issueWSToken(ctx, pid, uid)
	if e != nil {
		httpJSON(w, http.StatusInternalServerError, map[string]any{"error": "Token failed"})
		return
	}
	httpJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"party": map[string]any{
			"id": apply.Doc.ID, "title": apply.Doc.Title, "hostId": apply.Doc.HostID, "hostName": apply.Doc.HostName,
			"participantCount": len(apply.Doc.Participants),
		},
		"wsUrl": "/ws/v2", "wsToken": tk,
	})
}

var errInviteAlreadyExists = errors.New("invite already exists")

// materializeInvite stores invite keys in Redis and returns { link, code, expiresAt } for API JSON.
func (h *Handler) materializeInvite(ctx context.Context, partyID string, ttl time.Duration) (map[string]any, error) {
	if ttl <= 0 {
		ttl = h.Cfg.InviteTTLKey
	}
	partyID = strings.TrimSpace(partyID)
	if partyID == "" {
		return nil, errors.New("empty party id")
	}
	if existing, err := h.Store.FindInviteCodeForParty(ctx, partyID); err != nil {
		return nil, err
	} else if existing != "" {
		if err := h.Store.RefreshInvite(ctx, partyID, existing, ttl); err != nil {
			return nil, err
		}
		return h.buildInviteResponse(partyID, existing, time.Now().Add(ttl))
	}
	rawU := ulid.Make().String()
	code := strings.ToUpper(rawU[len(rawU)-8:])
	if len(code) == 8 {
		code = code[:4] + "-" + code[4:]
	}
	ok, err := h.Store.CreateInvite(ctx, partyID, code, ttl)
	if err != nil {
		return nil, err
	}
	if !ok {
		existing, ferr := h.Store.FindInviteCodeForParty(ctx, partyID)
		if ferr == nil && existing != "" {
			if err := h.Store.RefreshInvite(ctx, partyID, existing, ttl); err != nil {
				return nil, err
			}
			return h.buildInviteResponse(partyID, existing, time.Now().Add(ttl))
		}
		return nil, errInviteAlreadyExists
	}
	_ = h.Store.RepairInviteByCodeIndex(ctx, partyID, code, ttl)
	return h.buildInviteResponse(partyID, code, time.Now().Add(ttl))
}

func (h *Handler) buildInviteResponse(partyID string, code string, expiresAt time.Time) (map[string]any, error) {
	linkTok, _, err := invite.CreateLinkToken(h.JWTSecret, partyID, h.Cfg.InviteTTLLink)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"link":      "/api/party/join/" + linkTok,
		"code":      code,
		"expiresAt": expiresAt.UTC().Format(time.RFC3339),
	}, nil
}

func (h *Handler) createInvite(w http.ResponseWriter, r *http.Request) {
	uid := h.userID(r)
	if uid == "" {
		httpJSON(w, http.StatusUnauthorized, map[string]any{"error": "Authentication required", "code": "NO_SESSION"})
		return
	}
	requestedPID := strings.TrimSpace(chi.URLParam(r, "partyId"))
	pid := requestedPID
	ctx := r.Context()
	doc, err := h.Store.GetParty(ctx, pid)
	if err != nil {
		httpJSON(w, http.StatusInternalServerError, map[string]any{"error": "Server error", "code": "STORE_ERROR"})
		return
	}
	if doc == nil {
		recoveredPID, recoveredDoc, recErr := h.singleHostedParty(ctx, uid)
		if recErr != nil {
			httpJSON(w, http.StatusInternalServerError, map[string]any{"error": "Server error", "code": "STORE_ERROR"})
			return
		}
		if recoveredDoc == nil {
			if pid != "" {
				_ = h.Store.SRemHostIndex(ctx, uid, pid)
				_ = h.Store.DeleteInviteKeysForParty(ctx, pid)
			}
			httpJSON(w, http.StatusNotFound, map[string]any{"error": "Party not found", "code": "PARTY_NOT_FOUND"})
			return
		}
		pid = recoveredPID
		doc = recoveredDoc
	}
	if doc == nil {
		httpJSON(w, http.StatusNotFound, map[string]any{"error": "Party not found", "code": "PARTY_NOT_FOUND"})
		return
	}
	if doc.HostID != uid {
		httpJSON(w, http.StatusForbidden, map[string]any{"error": "Not authorized", "code": "NOT_AUTHORIZED"})
		return
	}
	var body struct {
		TTLSeconds *int `json:"ttlSeconds"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	ttl := h.Cfg.InviteTTLKey
	if body.TTLSeconds != nil && *body.TTLSeconds > 0 {
		ttl = time.Duration(*body.TTLSeconds) * time.Second
	}
	inv, mErr := h.materializeInvite(ctx, pid, ttl)
	if mErr != nil {
		if errors.Is(mErr, errInviteAlreadyExists) {
			httpJSON(w, http.StatusConflict, map[string]any{"error": "Invite already exists", "code": "ALREADY_EXISTS"})
			return
		}
		httpJSON(w, http.StatusInternalServerError, map[string]any{"error": "Server error"})
		return
	}
	out := map[string]any{"success": true, "partyId": pid, "invite": inv}
	if requestedPID != "" && requestedPID != pid {
		out["recoveredFromPartyId"] = requestedPID
	}
	httpJSON(w, http.StatusOK, out)
}

func (h *Handler) singleHostedParty(ctx context.Context, userID string) (string, *party.PartyDoc, error) {
	ids, err := h.Store.HostedParties(ctx, userID)
	if err != nil {
		return "", nil, err
	}
	var foundID string
	var foundDoc *party.PartyDoc
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		d, e := h.Store.GetParty(ctx, id)
		if e != nil {
			return "", nil, e
		}
		if d == nil {
			_ = h.Store.SRemHostIndex(ctx, userID, id)
			_ = h.Store.DeleteInviteKeysForParty(ctx, id)
			continue
		}
		if foundDoc != nil {
			return "", nil, nil
		}
		foundID = id
		foundDoc = d
	}
	return foundID, foundDoc, nil
}

func (h *Handler) wsTicket(w http.ResponseWriter, r *http.Request) {
	uid := h.userID(r)
	if uid == "" {
		httpJSON(w, http.StatusUnauthorized, map[string]any{"error": "Authentication required", "code": "NO_SESSION"})
		return
	}
	pid := chi.URLParam(r, "partyId")
	ctx := r.Context()
	doc, err := h.Store.GetParty(ctx, pid)
	if err != nil || doc == nil {
		httpJSON(w, http.StatusNotFound, map[string]any{"error": "Party not found", "code": "PARTY_NOT_FOUND"})
		return
	}
	if _, ok := doc.Participants[uid]; !ok {
		if doc.IsPrivate {
			httpJSON(w, http.StatusForbidden, map[string]any{"error": "You must be a participant", "code": "NOT_AUTHORIZED"})
			return
		}
		aj, e := h.Store.ApplyCommand(ctx, map[string]any{"type": "join", "partyId": pid, "userId": uid, "username": h.userName(r)})
		if e != nil || aj == nil || !aj.OK {
			httpJSON(w, http.StatusInternalServerError, map[string]any{"error": "Server error"})
			return
		}
	}
	tok, err := h.issueWSToken(ctx, pid, uid)
	if err != nil {
		httpJSON(w, http.StatusInternalServerError, map[string]any{"error": "Token failed"})
		return
	}
	httpJSON(w, http.StatusOK, map[string]any{
		"ticket": tok, "expiresAt": time.Now().Add(5 * time.Minute).UTC().Format(time.RFC3339), "ttlSeconds": 300,
	})
}

func (h *Handler) leave(w http.ResponseWriter, r *http.Request) {
	uid := h.userID(r)
	if uid == "" {
		httpJSON(w, http.StatusUnauthorized, map[string]any{"error": "Authentication required", "code": "NO_SESSION"})
		return
	}
	pid := chi.URLParam(r, "partyId")
	ctx := r.Context()
	doc, _ := h.Store.GetParty(ctx, pid)
	apply, err := h.Store.ApplyCommand(ctx, map[string]any{"type": "leave", "partyId": pid, "userId": uid})
	if err != nil {
		httpJSON(w, http.StatusInternalServerError, map[string]any{"error": "Server error"})
		return
	}
	if apply == nil || !apply.OK {
		httpJSON(w, http.StatusNotFound, map[string]any{"error": "Party not found", "code": apply.Code})
		return
	}
	ended := doc != nil && doc.HostID == uid
	if ended {
		_ = h.Store.DeleteInviteKeysForParty(ctx, pid)
		_ = h.Store.SRemHostIndex(ctx, uid, pid)
	}
	httpJSON(w, http.StatusOK, map[string]any{"success": true, "partyEnded": ended})
}

func (h *Handler) end(w http.ResponseWriter, r *http.Request) {
	uid := h.userID(r)
	if uid == "" {
		httpJSON(w, http.StatusUnauthorized, map[string]any{"error": "Authentication required", "code": "NO_SESSION"})
		return
	}
	pid := chi.URLParam(r, "partyId")
	ctx := r.Context()
	doc, _ := h.Store.GetParty(ctx, pid)
	apply, err := h.Store.ApplyCommand(ctx, map[string]any{"type": "end", "partyId": pid, "userId": uid})
	if err != nil {
		httpJSON(w, http.StatusInternalServerError, map[string]any{"error": "Server error"})
		return
	}
	if apply == nil {
		if doc == nil {
			_ = h.Store.DeleteInviteKeysForParty(ctx, pid)
			httpJSON(w, http.StatusOK, map[string]any{"success": true, "alreadyEnded": true})
			return
		}
	}
	if !apply.OK {
		if apply.Code == "NOT_FOUND" {
			_ = h.Store.DeleteInviteKeysForParty(ctx, pid)
			httpJSON(w, http.StatusOK, map[string]any{"success": true, "alreadyEnded": true})
			return
		}
		if apply.Code == "NOT_AUTHORIZED" {
			httpJSON(w, http.StatusForbidden, map[string]any{"error": "Only the host can end the party", "code": "NOT_AUTHORIZED"})
			return
		}
		httpJSON(w, http.StatusNotFound, map[string]any{"error": "Party not found", "code": "PARTY_NOT_FOUND"})
		return
	}
	hostID := ""
	if apply.Doc != nil {
		hostID = apply.Doc.HostID
	} else if doc != nil {
		hostID = doc.HostID
	}
	if hostID != "" {
		_ = h.Store.SRemHostIndex(ctx, hostID, pid)
	}
	_ = h.Store.DeleteInviteKeysForParty(ctx, pid)
	httpJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (h *Handler) getUserActive(w http.ResponseWriter, r *http.Request) {
	uid := h.userID(r)
	if uid == "" {
		httpJSON(w, http.StatusUnauthorized, map[string]any{"error": "Authentication required", "code": "NO_SESSION"})
		return
	}
	ctx := r.Context()
	ids, _ := h.Store.HostedParties(ctx, uid)
	var parties []any
	for _, id := range ids {
		d, e := h.Store.GetParty(ctx, id)
		if e != nil || d == nil {
			if e == nil {
				_ = h.Store.SRemHostIndex(ctx, uid, id)
				_ = h.Store.DeleteInviteKeysForParty(ctx, id)
			}
			continue
		}
		parties = append(parties, map[string]any{
			"id": id, "title": d.Title, "description": d.Description, "participantCount": len(d.Participants),
			"maxParticipants": d.MaxParticipants, "createdAt": time.UnixMilli(d.CreatedAtMs).UTC().Format(time.RFC3339),
		})
	}
	httpJSON(w, http.StatusOK, map[string]any{"parties": parties, "count": len(parties)})
}

func (h *Handler) userCleanup(w http.ResponseWriter, r *http.Request) {
	uid := h.userID(r)
	if uid == "" {
		httpJSON(w, http.StatusUnauthorized, map[string]any{"error": "Authentication required", "code": "NO_SESSION"})
		return
	}
	ctx := r.Context()
	ids, _ := h.Store.HostedParties(ctx, uid)
	for _, id := range ids {
		_, _ = h.Store.ApplyCommand(ctx, map[string]any{"type": "end", "partyId": id, "userId": uid})
		_ = h.Store.SRemHostIndex(ctx, uid, id)
	}
	httpJSON(w, http.StatusOK, map[string]any{"success": true, "ended": len(ids)})
}

func (h *Handler) issueWSToken(_ context.Context, partyID, userID string) (string, error) {
	nonce, err := wstoken.RandomNonce()
	if err != nil {
		return "", err
	}
	exp := time.Now().Add(5 * time.Minute).UnixMilli()
	return wstoken.Sign(h.Cfg.WSTokenSecret, wstoken.Claims{
		V: 1, PartyID: partyID, UserID: userID, ExpMS: exp, Nonce: nonce,
	})
}

// normalizeInviteCodePunctuation unifies dash-like Unicode and strips invisible
// characters so a pasted "party code" matches Redis keys (ASCII hyphen + A–Z/0–9).
func normalizeInviteCodePunctuation(s string) string {
	s = strings.TrimSpace(s)
	s = strings.NewReplacer(
		"\u2010", "-", // hyphen
		"\u2011", "-", // non-breaking hyphen
		"\u2012", "-", // figure dash
		"\u2013", "-", // en dash
		"\u2014", "-", // em dash
		"\u2015", "-", // horizontal bar
		"\u2212", "-", // minus sign
		"\uff0d", "-", // fullwidth hyphen-minus
		"\u00ad", "", // soft hyphen
		"\ufeff", "", // BOM
		"\u200b", "", // zero width space
		"\u200c", "", // zero width non-joiner
		"\u200d", "", // zero width joiner
		"\u2060", "", // word joiner
	).Replace(s)
	return s
}

func inviteCodeCandidates(raw string) []string {
	trimmed := strings.TrimSpace(normalizeInviteCodePunctuation(raw))
	var compactBuilder strings.Builder
	compactBuilder.Grow(len(trimmed))
	for _, r := range trimmed {
		switch {
		case r >= 'a' && r <= 'z':
			compactBuilder.WriteRune(r - ('a' - 'A'))
		case r >= 'A' && r <= 'Z':
			compactBuilder.WriteRune(r)
		case r >= '0' && r <= '9':
			compactBuilder.WriteRune(r)
		}
	}

	compact := compactBuilder.String()
	if len(compact) < 6 {
		return nil
	}

	add := func(out []string, seen map[string]struct{}, v string) []string {
		v = strings.TrimSpace(v)
		if v == "" {
			return out
		}
		if _, ok := seen[v]; ok {
			return out
		}
		seen[v] = struct{}{}
		return append(out, v)
	}

	seen := make(map[string]struct{}, 6)
	out := make([]string, 0, 6)
	out = add(out, seen, trimmed)
	out = add(out, seen, strings.ToUpper(trimmed))
	out = add(out, seen, compact)
	if len(compact) == 8 {
		out = add(out, seen, compact[:4]+"-"+compact[4:])
	}
	return out
}

func (h *Handler) resolvePartyIDByInviteCode(ctx context.Context, candidates []string) (string, string, error) {
	for _, c := range candidates {
		p, err := h.Store.PartyIDByCode(ctx, c)
		if err != nil {
			return "", "", err
		}
		if p != "" {
			return p, c, nil
		}
	}
	for _, c := range candidates {
		p, err := h.Store.PartyIDByInviteCodeFallback(ctx, c)
		if err != nil {
			return "", "", err
		}
		if p != "" {
			return p, c, nil
		}
	}
	return "", "", nil
}
