package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/earflow/music-platform/party-go/internal/wire"
)

type config struct {
	stateURL       string
	wsURL          string
	rooms          int
	guestsPerRoom  int
	updatesPerRoom int
	concurrency    int
	timeout        time.Duration
	stepTimeout    time.Duration
	think          time.Duration
	verbose        bool
}

type roomResult struct {
	index       int
	partyID     string
	err         error
	duration    time.Duration
	latenciesMs []float64
}

type httpError struct {
	Method string
	URL    string
	Status int
	Body   string
}

func (e *httpError) Error() string {
	body := strings.TrimSpace(e.Body)
	if len(body) > 240 {
		body = body[:240] + "..."
	}
	return fmt.Sprintf("%s %s -> %d %s", e.Method, e.URL, e.Status, body)
}

type createPartyResponse struct {
	Success    bool   `json:"success"`
	WSToken    string `json:"wsToken"`
	Ticket     string `json:"ticket"`
	InviteCode string `json:"inviteCode"`
	Party      struct {
		ID string `json:"id"`
	} `json:"party"`
	Invite struct {
		Code string `json:"code"`
	} `json:"invite"`
}

type inviteResponse struct {
	Success bool `json:"success"`
	Invite  struct {
		Code string `json:"code"`
	} `json:"invite"`
}

type joinResponse struct {
	Success bool   `json:"success"`
	WSToken string `json:"wsToken"`
	Ticket  string `json:"ticket"`
	Party   struct {
		ID string `json:"id"`
	} `json:"party"`
}

type getPartyResponse struct {
	Participants []any `json:"participants"`
	Queue        []any `json:"queue"`
	Party        struct {
		ID string `json:"id"`
	} `json:"party"`
}

type wsClient struct {
	name    string
	userID  string
	partyID string
	conn    *websocket.Conn
	msgs    chan map[string]any
	errs    chan error
	cancel  context.CancelFunc
}

func main() {
	cfg := config{}
	flag.StringVar(&cfg.stateURL, "state-url", envOr("PARTY_STATE_URL", "http://localhost:3130"), "party-state-service base URL")
	flag.StringVar(&cfg.wsURL, "ws-url", envOr("PARTY_WS_URL", "ws://localhost:3131/ws/v2"), "party-gateway-service websocket URL")
	flag.IntVar(&cfg.rooms, "rooms", envInt("PARTY_TEST_ROOMS", 2), "number of rooms to create")
	flag.IntVar(&cfg.guestsPerRoom, "guests", envInt("PARTY_TEST_GUESTS", 4), "guests per room")
	flag.IntVar(&cfg.updatesPerRoom, "updates", envInt("PARTY_TEST_UPDATES", 8), "playback updates per room")
	flag.IntVar(&cfg.concurrency, "concurrency", envInt("PARTY_TEST_CONCURRENCY", 2), "parallel room scenarios")
	flag.DurationVar(&cfg.timeout, "timeout", envDuration("PARTY_TEST_TIMEOUT", 90*time.Second), "total test timeout")
	flag.DurationVar(&cfg.stepTimeout, "step-timeout", envDuration("PARTY_TEST_STEP_TIMEOUT", 6*time.Second), "single step timeout")
	flag.DurationVar(&cfg.think, "think", envDuration("PARTY_TEST_THINK", 80*time.Millisecond), "pause between host playback updates")
	flag.BoolVar(&cfg.verbose, "v", envBool("PARTY_TEST_VERBOSE", false), "verbose logging")
	flag.Parse()

	if err := cfg.validate(); err != nil {
		fmt.Fprintln(os.Stderr, "invalid config:", err)
		os.Exit(2)
	}

	ctx, cancel := context.WithTimeout(context.Background(), cfg.timeout)
	defer cancel()

	start := time.Now()
	results := run(ctx, cfg)
	failed := 0
	allLatencies := make([]float64, 0)

	for _, r := range results {
		allLatencies = append(allLatencies, r.latenciesMs...)
		if r.err != nil {
			failed++
			fmt.Printf("FAIL room=%d party=%s duration=%s error=%v\n", r.index, r.partyID, r.duration.Round(time.Millisecond), r.err)
		} else {
			fmt.Printf("OK   room=%d party=%s duration=%s events=%d\n", r.index, r.partyID, r.duration.Round(time.Millisecond), len(r.latenciesMs))
		}
	}

	sort.Float64s(allLatencies)
	fmt.Println()
	fmt.Printf("Party smoke/load summary: rooms=%d failed=%d guestsPerRoom=%d updatesPerRoom=%d concurrency=%d duration=%s\n",
		cfg.rooms, failed, cfg.guestsPerRoom, cfg.updatesPerRoom, cfg.concurrency, time.Since(start).Round(time.Millisecond))
	if len(allLatencies) > 0 {
		fmt.Printf("WS propagation latency ms: p50=%.1f p95=%.1f p99=%.1f max=%.1f samples=%d\n",
			percentile(allLatencies, 50), percentile(allLatencies, 95), percentile(allLatencies, 99), allLatencies[len(allLatencies)-1], len(allLatencies))
	}

	if failed > 0 {
		os.Exit(1)
	}
}

func (c config) validate() error {
	if strings.TrimSpace(c.stateURL) == "" {
		return errors.New("state-url is required")
	}
	if strings.TrimSpace(c.wsURL) == "" {
		return errors.New("ws-url is required")
	}
	if c.rooms <= 0 || c.guestsPerRoom < 0 || c.updatesPerRoom <= 0 || c.concurrency <= 0 {
		return errors.New("rooms, updates and concurrency must be > 0; guests must be >= 0")
	}
	if c.stepTimeout <= 0 || c.timeout <= 0 {
		return errors.New("timeouts must be positive")
	}
	return nil
}

func run(ctx context.Context, cfg config) []roomResult {
	results := make([]roomResult, cfg.rooms)
	sem := make(chan struct{}, cfg.concurrency)
	var wg sync.WaitGroup
	var seq int64
	runID := fmt.Sprintf("%d", time.Now().UnixNano())

	for i := 0; i < cfg.rooms; i++ {
		i := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				results[i] = roomResult{index: i, err: ctx.Err()}
				return
			}
			roomSeq := atomic.AddInt64(&seq, 1)
			results[i] = runRoom(ctx, cfg, runID, i, roomSeq)
		}()
	}

	wg.Wait()
	return results
}

func runRoom(ctx context.Context, cfg config, runID string, index int, roomSeq int64) (res roomResult) {
	start := time.Now()
	res.index = index
	defer func() {
		res.duration = time.Since(start)
	}()

	hostID := fmt.Sprintf("party-smoke-host-%s-%03d", runID, roomSeq)
	hostName := fmt.Sprintf("Smoke Host %03d", roomSeq)
	partyTitle := fmt.Sprintf("Smoke Party %s/%03d", runID, roomSeq)

	createResp := createPartyResponse{}
	if err := httpJSON(ctx, http.MethodPost, joinURL(cfg.stateURL, "/api/party"), hostID, hostName, map[string]any{
		"title":     partyTitle,
		"isPrivate": true,
	}, http.StatusCreated, &createResp); err != nil {
		res.err = fmt.Errorf("create party: %w", err)
		return
	}
	partyID := strings.TrimSpace(createResp.Party.ID)
	res.partyID = partyID
	if partyID == "" {
		res.err = errors.New("create party returned empty party id")
		return
	}
	hostToken := firstNonEmpty(createResp.WSToken, createResp.Ticket)
	if hostToken == "" {
		res.err = errors.New("create party returned empty ws token")
		return
	}
	inviteCode := firstNonEmpty(createResp.InviteCode, createResp.Invite.Code)
	if inviteCode == "" {
		inv := inviteResponse{}
		if err := httpJSON(ctx, http.MethodPost, joinURL(cfg.stateURL, "/api/party/"+url.PathEscape(partyID)+"/invite"), hostID, hostName, map[string]any{
			"ttlSeconds": 1800,
		}, http.StatusOK, &inv); err != nil {
			res.err = fmt.Errorf("create invite: %w", err)
			return
		}
		inviteCode = inv.Invite.Code
	}
	if inviteCode == "" {
		res.err = errors.New("empty invite code")
		return
	}

	host, err := connectWS(ctx, cfg, partyID, hostID, hostName, hostToken)
	if err != nil {
		res.err = fmt.Errorf("host ws connect: %w", err)
		return
	}
	defer host.close()
	if err := waitFor(ctx, host, cfg.stepTimeout, isInitForParty(partyID)); err != nil {
		res.err = fmt.Errorf("host init: %w", err)
		return
	}

	guests := make([]*wsClient, 0, cfg.guestsPerRoom)
	for i := 0; i < cfg.guestsPerRoom; i++ {
		guestID := fmt.Sprintf("party-smoke-guest-%s-%03d-%03d", runID, roomSeq, i)
		guestName := fmt.Sprintf("Smoke Guest %03d.%03d", roomSeq, i)
		joinResp := joinResponse{}
		if err := httpJSON(ctx, http.MethodPost, joinURL(cfg.stateURL, "/api/party/join/code"), guestID, guestName, map[string]any{
			"code":     inviteCode,
			"userName": guestName,
		}, http.StatusOK, &joinResp); err != nil {
			res.err = fmt.Errorf("guest %d join by code: %w", i, err)
			return
		}
		token := firstNonEmpty(joinResp.WSToken, joinResp.Ticket)
		if token == "" {
			res.err = fmt.Errorf("guest %d join returned empty ws token", i)
			return
		}
		g, err := connectWS(ctx, cfg, partyID, guestID, guestName, token)
		if err != nil {
			res.err = fmt.Errorf("guest %d ws connect: %w", i, err)
			return
		}
		guests = append(guests, g)
		defer g.close()
		if err := waitFor(ctx, g, cfg.stepTimeout, isInitForParty(partyID)); err != nil {
			res.err = fmt.Errorf("guest %d init: %w", i, err)
			return
		}
	}

	state := getPartyResponse{}
	if err := httpJSON(ctx, http.MethodGet, joinURL(cfg.stateURL, "/api/party/"+url.PathEscape(partyID)), hostID, hostName, nil, http.StatusOK, &state); err != nil {
		res.err = fmt.Errorf("get party: %w", err)
		return
	}
	wantParticipants := cfg.guestsPerRoom + 1
	if len(state.Participants) < wantParticipants {
		res.err = fmt.Errorf("participant count = %d, want at least %d", len(state.Participants), wantParticipants)
		return
	}

	for i := 0; i < cfg.updatesPerRoom; i++ {
		trackID := fmt.Sprintf("smoke-track-%03d-%03d", roomSeq, i)
		sentAt := time.Now()
		if err := host.sendCommand(ctx, map[string]any{
			"type":            "playback_update",
			"partyId":         partyID,
			"userId":          hostID,
			"trackId":         trackID,
			"trackTitle":      fmt.Sprintf("Smoke Track %03d", i),
			"trackArtist":     "Party Smoke",
			"trackDurationMs": 180000,
			"positionMs":      i * 1000,
			"isPlaying":       true,
		}); err != nil {
			res.err = fmt.Errorf("host playback update %d: %w", i, err)
			return
		}
		for gi, g := range guests {
			if err := waitFor(ctx, g, cfg.stepTimeout, isPlaybackTrack(trackID)); err != nil {
				res.err = fmt.Errorf("guest %d playback event %d: %w", gi, i, err)
				return
			}
			res.latenciesMs = append(res.latenciesMs, float64(time.Since(sentAt).Microseconds())/1000)
		}
		if cfg.think > 0 {
			select {
			case <-time.After(cfg.think):
			case <-ctx.Done():
				res.err = ctx.Err()
				return
			}
		}
	}

	if len(guests) > 0 {
		if err := host.sendCommand(ctx, map[string]any{
			"type":    "set_permissions",
			"partyId": partyID,
			"userId":  hostID,
			"permissions": map[string]any{
				"guestsCanAddToQueue":      true,
				"guestsCanRemoveFromQueue": true,
				"guestsCanPlayPause":       false,
				"guestsCanSeek":            false,
				"guestsCanSkip":            false,
			},
		}); err != nil {
			res.err = fmt.Errorf("set permissions: %w", err)
			return
		}
		if err := waitFor(ctx, guests[0], cfg.stepTimeout, hasEventType("permissions_updated")); err != nil {
			res.err = fmt.Errorf("guest permissions update: %w", err)
			return
		}

		if err := guests[0].sendCommand(ctx, map[string]any{
			"type":    "add_to_queue",
			"partyId": partyID,
			"userId":  guests[0].userID,
			"track": map[string]any{
				"id":         fmt.Sprintf("queue-smoke-%03d", roomSeq),
				"title":      "Queue Smoke",
				"artist":     "Party Smoke",
				"durationMs": 123000,
			},
		}); err != nil {
			res.err = fmt.Errorf("guest add queue: %w", err)
			return
		}
		if err := waitFor(ctx, host, cfg.stepTimeout, queueLenAtLeast(1)); err != nil {
			res.err = fmt.Errorf("host queue add event: %w", err)
			return
		}
		queueState := getPartyResponse{}
		if err := httpJSON(ctx, http.MethodGet, joinURL(cfg.stateURL, "/api/party/"+url.PathEscape(partyID)), hostID, hostName, nil, http.StatusOK, &queueState); err != nil {
			res.err = fmt.Errorf("get queue state: %w", err)
			return
		}
		queueID := firstQueueID(queueState.Queue)
		if queueID == "" {
			res.err = errors.New("queue add returned item without queueId")
			return
		}

		if err := guests[0].sendCommand(ctx, map[string]any{
			"type":    "remove_from_queue",
			"partyId": partyID,
			"userId":  guests[0].userID,
			"queueId": queueID,
		}); err != nil {
			res.err = fmt.Errorf("guest remove queue: %w", err)
			return
		}
		if err := waitFor(ctx, host, cfg.stepTimeout, queueLenEquals(0)); err != nil {
			res.err = fmt.Errorf("host queue remove event: %w", err)
			return
		}
	}

	for i, g := range guests {
		if err := httpJSON(ctx, http.MethodPost, joinURL(cfg.stateURL, "/api/party/"+url.PathEscape(partyID)+"/leave"), g.userID, g.name, nil, http.StatusOK, nil); err != nil {
			res.err = fmt.Errorf("guest %d leave: %w", i, err)
			return
		}
	}
	if err := httpJSON(ctx, http.MethodDelete, joinURL(cfg.stateURL, "/api/party/"+url.PathEscape(partyID)), hostID, hostName, nil, http.StatusOK, nil); err != nil {
		res.err = fmt.Errorf("host end: %w", err)
		return
	}

	if cfg.verbose {
		fmt.Printf("room=%d party=%s finished lifecycle\n", index, partyID)
	}
	return
}

func connectWS(ctx context.Context, cfg config, partyID, userID, userName, token string) (*wsClient, error) {
	u, err := url.Parse(cfg.wsURL)
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("wsToken", token)
	u.RawQuery = q.Encode()

	stepCtx, cancel := context.WithTimeout(ctx, cfg.stepTimeout)
	defer cancel()
	c, _, err := websocket.Dial(stepCtx, u.String(), &websocket.DialOptions{
		HTTPHeader: http.Header{
			"X-User-Id":   []string{userID},
			"X-User-Name": []string{userName},
		},
	})
	if err != nil {
		return nil, err
	}

	readCtx, readCancel := context.WithCancel(context.Background())
	client := &wsClient{
		name:    userName,
		userID:  userID,
		partyID: partyID,
		conn:    c,
		msgs:    make(chan map[string]any, 512),
		errs:    make(chan error, 1),
		cancel:  readCancel,
	}
	go client.readLoop(readCtx)
	return client, nil
}

func (c *wsClient) readLoop(ctx context.Context) {
	defer close(c.msgs)
	for {
		typ, b, err := c.conn.Read(ctx)
		if err != nil {
			select {
			case <-ctx.Done():
			default:
				select {
				case c.errs <- err:
				default:
				}
			}
			return
		}
		if typ != websocket.MessageBinary {
			continue
		}
		m, err := wire.DecodeMap(b)
		if err != nil {
			select {
			case c.errs <- err:
			default:
			}
			continue
		}
		select {
		case c.msgs <- m:
		case <-ctx.Done():
			return
		}
	}
}

func (c *wsClient) close() {
	if c == nil {
		return
	}
	if c.cancel != nil {
		c.cancel()
	}
	if c.conn != nil {
		_ = c.conn.Close(websocket.StatusNormalClosure, "done")
	}
}

func (c *wsClient) sendCommand(ctx context.Context, cmd map[string]any) error {
	b, err := wire.Encode(map[string]any{
		"t":       "cmd",
		"id":      fmt.Sprintf("%d", time.Now().UnixNano()),
		"partyId": c.partyID,
		"payload": map[string]any{"cmd": cmd},
	})
	if err != nil {
		return err
	}
	stepCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	return c.conn.Write(stepCtx, websocket.MessageBinary, b)
}

func waitFor(ctx context.Context, c *wsClient, timeout time.Duration, pred func(map[string]any) bool) error {
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err := <-c.errs:
			if err != nil {
				return err
			}
		case m, ok := <-c.msgs:
			if !ok {
				return errors.New("websocket closed")
			}
			if pred(m) {
				return nil
			}
		case <-timer.C:
			return fmt.Errorf("timeout waiting for party ws event for user %s", c.userID)
		}
	}
}

func isInitForParty(partyID string) func(map[string]any) bool {
	return func(m map[string]any) bool {
		if str(m["t"]) != "reply" {
			return false
		}
		p := mapAny(m["payload"])
		if p == nil || p["ok"] != true {
			return false
		}
		doc := mapAny(p["doc"])
		return doc != nil && str(doc["id"]) == partyID
	}
}

func hasEventType(kind string) func(map[string]any) bool {
	return func(m map[string]any) bool {
		return eventType(m) == kind
	}
}

func isPlaybackTrack(trackID string) func(map[string]any) bool {
	return func(m map[string]any) bool {
		if eventType(m) != "playback" {
			return false
		}
		pb := mapAny(mapAny(m["payload"])["playback"])
		return pb != nil && str(pb["trackId"]) == trackID
	}
}

func queueLenAtLeast(n int) func(map[string]any) bool {
	return func(m map[string]any) bool {
		if eventType(m) != "queue" {
			return false
		}
		q, ok := mapAny(m["payload"])["queue"].([]any)
		return ok && len(q) >= n
	}
}

func queueLenEquals(n int) func(map[string]any) bool {
	return func(m map[string]any) bool {
		if eventType(m) != "queue" {
			return false
		}
		q, ok := mapAny(m["payload"])["queue"].([]any)
		return ok && len(q) == n
	}
}

func firstQueueID(queue []any) string {
	if len(queue) == 0 {
		return ""
	}
	item := mapAny(queue[0])
	if item == nil {
		return ""
	}
	return strings.TrimSpace(str(item["queueId"]))
}

func eventType(m map[string]any) string {
	if str(m["t"]) != "event" {
		return ""
	}
	return str(mapAny(m["payload"])["t"])
}

func httpJSON(ctx context.Context, method, rawURL, userID, userName string, body any, wantStatus int, out any) error {
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, rawURL, r)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if userID != "" {
		req.Header.Set("X-User-Id", userID)
	}
	if userName != "" {
		req.Header.Set("X-User-Name", userName)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != wantStatus {
		return &httpError{Method: method, URL: rawURL, Status: resp.StatusCode, Body: string(b)}
	}
	if out != nil && len(bytes.TrimSpace(b)) > 0 {
		if err := json.Unmarshal(b, out); err != nil {
			return fmt.Errorf("decode response: %w body=%s", err, string(b))
		}
	}
	return nil
}

func joinURL(base, path string) string {
	base = strings.TrimRight(base, "/")
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return base + path
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func mapAny(v any) map[string]any {
	m, _ := v.(map[string]any)
	if m == nil {
		return map[string]any{}
	}
	return m
}

func str(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case fmt.Stringer:
		return t.String()
	case nil:
		return ""
	default:
		return fmt.Sprint(t)
	}
}

func percentile(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	if len(sorted) == 1 {
		return sorted[0]
	}
	idx := (p / 100) * float64(len(sorted)-1)
	lo := int(math.Floor(idx))
	hi := int(math.Ceil(idx))
	if lo == hi {
		return sorted[lo]
	}
	frac := idx - float64(lo)
	return sorted[lo]*(1-frac) + sorted[hi]*frac
}

func envOr(name, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(name)); v != "" {
		return v
	}
	return fallback
}

func envInt(name string, fallback int) int {
	var n int
	if _, err := fmt.Sscanf(strings.TrimSpace(os.Getenv(name)), "%d", &n); err == nil {
		return n
	}
	return fallback
}

func envBool(name string, fallback bool) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(name))) {
	case "1", "true", "yes", "y", "on":
		return true
	case "0", "false", "no", "n", "off":
		return false
	default:
		return fallback
	}
}

func envDuration(name string, fallback time.Duration) time.Duration {
	v := strings.TrimSpace(os.Getenv(name))
	if v == "" {
		return fallback
	}
	if d, err := time.ParseDuration(v); err == nil {
		return d
	}
	var seconds int
	if _, err := fmt.Sscanf(v, "%d", &seconds); err == nil && seconds > 0 {
		return time.Duration(seconds) * time.Second
	}
	return fallback
}
