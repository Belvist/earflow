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
)

type config struct {
	baseURL             string
	userID              string
	username            string
	accounts            int
	devicesPerAccount   int
	transfersPerAccount int
	concurrency         int
	timeout             time.Duration
	stepTimeout         time.Duration
	verbose             bool
}

type deviceResponse struct {
	DeviceID string `json:"deviceId"`
	Device   struct {
		ID string `json:"id"`
	} `json:"device"`
}

type ticketResponse struct {
	Ticket string `json:"ticket"`
}

type transferResponse struct {
	TransferID string `json:"transferId"`
	Transfer   struct {
		TransferID string `json:"transferId"`
	} `json:"transfer"`
}

type accountResult struct {
	index       int
	userID      string
	err         error
	duration    time.Duration
	latenciesMs []float64
}

type wsClient struct {
	name   string
	id     string
	conn   *websocket.Conn
	frames chan map[string]any
	errs   chan error
	cancel context.CancelFunc
}

func main() {
	cfg := config{}
	flag.StringVar(&cfg.baseURL, "base-url", envOr("DEVICE_SYNC_URL", "http://localhost:3050"), "device-sync-service base URL")
	flag.StringVar(&cfg.userID, "user-id", envOr("DEVICE_SYNC_TEST_USER_ID", "device-sync-smoke"), "test user id")
	flag.StringVar(&cfg.username, "username", envOr("DEVICE_SYNC_TEST_USERNAME", "Device Sync Smoke"), "test username")
	flag.IntVar(&cfg.accounts, "accounts", envInt("DEVICE_SYNC_TEST_ACCOUNTS", 10), "number of isolated test accounts")
	flag.IntVar(&cfg.devicesPerAccount, "devices", envInt("DEVICE_SYNC_TEST_DEVICES", 5), "devices per test account")
	flag.IntVar(&cfg.transfersPerAccount, "transfers", envInt("DEVICE_SYNC_TEST_TRANSFERS", 10), "transfers per account")
	flag.IntVar(&cfg.concurrency, "concurrency", envInt("DEVICE_SYNC_TEST_CONCURRENCY", 5), "parallel accounts")
	flag.DurationVar(&cfg.timeout, "timeout", envDuration("DEVICE_SYNC_TEST_TIMEOUT", 2*time.Minute), "total smoke timeout")
	flag.DurationVar(&cfg.stepTimeout, "step-timeout", envDuration("DEVICE_SYNC_TEST_STEP_TIMEOUT", 5*time.Second), "single step timeout")
	flag.BoolVar(&cfg.verbose, "v", envBool("DEVICE_SYNC_TEST_VERBOSE", false), "verbose logging")
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
	latencies := make([]float64, 0)
	for _, result := range results {
		latencies = append(latencies, result.latenciesMs...)
		if result.err != nil {
			failed++
			fmt.Printf("FAIL account=%d user=%s duration=%s error=%v\n",
				result.index, result.userID, result.duration.Round(time.Millisecond), result.err)
			continue
		}
		fmt.Printf("OK   account=%d user=%s duration=%s transfers=%d\n",
			result.index, result.userID, result.duration.Round(time.Millisecond), len(result.latenciesMs))
	}
	sort.Float64s(latencies)
	fmt.Println()
	fmt.Printf("Device sync stress summary: accounts=%d devices=%d transfersPerAccount=%d concurrency=%d failed=%d duration=%s\n",
		cfg.accounts, cfg.devicesPerAccount, cfg.transfersPerAccount, cfg.concurrency, failed, time.Since(start).Round(time.Millisecond))
	if len(latencies) > 0 {
		fmt.Printf("Transfer reconcile latency ms: p50=%.1f p95=%.1f p99=%.1f max=%.1f samples=%d\n",
			percentile(latencies, 50), percentile(latencies, 95), percentile(latencies, 99), latencies[len(latencies)-1], len(latencies))
	}
	if failed > 0 {
		os.Exit(1)
	}
}

func (cfg config) validate() error {
	if strings.TrimSpace(cfg.baseURL) == "" || strings.TrimSpace(cfg.userID) == "" {
		return errors.New("base-url and user-id are required")
	}
	if cfg.accounts < 1 || cfg.accounts > 100 {
		return errors.New("accounts must be 1..100")
	}
	if cfg.devicesPerAccount < 2 || cfg.devicesPerAccount > 30 {
		return errors.New("devices must be 2..30")
	}
	if cfg.transfersPerAccount < 1 || cfg.transfersPerAccount > 500 {
		return errors.New("transfers must be 1..500")
	}
	if cfg.concurrency < 1 {
		cfg.concurrency = 1
	}
	return nil
}

func run(ctx context.Context, cfg config) []accountResult {
	results := make([]accountResult, cfg.accounts)
	sem := make(chan struct{}, cfg.concurrency)
	var wg sync.WaitGroup
	var started atomic.Int64
	for i := 0; i < cfg.accounts; i++ {
		i := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			accountCfg := cfg
			accountCfg.userID = fmt.Sprintf("%s-%02d", cfg.userID, i)
			accountCfg.username = fmt.Sprintf("%s %02d", cfg.username, i)
			started.Add(1)
			start := time.Now()
			latencies, err := runAccount(ctx, accountCfg, i)
			results[i] = accountResult{
				index:       i,
				userID:      accountCfg.userID,
				err:         err,
				duration:    time.Since(start),
				latenciesMs: latencies,
			}
		}()
	}
	wg.Wait()
	_ = started.Load()
	return results
}

func runAccount(ctx context.Context, cfg config, accountIndex int) ([]float64, error) {
	httpClient := &http.Client{Timeout: cfg.stepTimeout}

	devices := make([]string, cfg.devicesPerAccount)
	if cfg.verbose {
		fmt.Printf("account=%d registering %d devices\n", accountIndex, cfg.devicesPerAccount)
	}
	for i := range devices {
		id, err := registerDevice(ctx, httpClient, cfg, fmt.Sprintf("Smoke %02d/%02d", accountIndex, i))
		if err != nil {
			return nil, fmt.Errorf("register device %d: %w", i, err)
		}
		devices[i] = id
	}

	clients := make([]*wsClient, len(devices))
	for i, deviceID := range devices {
		client, err := openDeviceWS(ctx, httpClient, cfg, deviceID, fmt.Sprintf("d-%d", i))
		if err != nil {
			closeClients(clients)
			return nil, fmt.Errorf("open ws device %d: %w", i, err)
		}
		clients[i] = client
	}
	defer closeClients(clients)

	for i, client := range clients {
		if _, err := waitForFrame(ctx, cfg.stepTimeout, client, func(frame map[string]any) bool {
			return frame["type"] == "init"
		}); err != nil {
			return nil, fmt.Errorf("wait init device %d: %w", i, err)
		}
	}

	if _, err := transfer(ctx, httpClient, cfg, devices[0], true, "initial"); err != nil {
		return nil, fmt.Errorf("transfer initial: %w", err)
	}
	if err := putNowPlaying(ctx, httpClient, cfg, devices[0]); err != nil {
		return nil, fmt.Errorf("publish nowPlaying: %w", err)
	}

	latencies := make([]float64, 0, cfg.transfersPerAccount)
	current := 0
	for i := 0; i < cfg.transfersPerAccount; i++ {
		next := (i + 1) % len(devices)
		if next == current {
			next = (next + 1) % len(devices)
		}
		start := time.Now()
		transferID, err := transfer(ctx, httpClient, cfg, devices[next], true, fmt.Sprintf("stress-%02d", i))
		if err != nil {
			return latencies, fmt.Errorf("transfer %d to device %d: %w", i, next, err)
		}
		if err := expectAndAck(ctx, cfg, clients[current], CommandRevokeAudio, transferID); err != nil {
			return latencies, fmt.Errorf("transfer %d revoke ack: %w", i, err)
		}
		if err := expectAndAck(ctx, cfg, clients[next], CommandTransfer, transferID); err != nil {
			return latencies, fmt.Errorf("transfer %d activate ack: %w", i, err)
		}
		if _, err := waitForFrame(ctx, cfg.stepTimeout, clients[next], func(frame map[string]any) bool {
			transfer, _ := frame["transfer"].(map[string]any)
			return frame["type"] == "transfer:update" &&
				stringField(transfer, "transferId") == transferID &&
				transfer["phase"] == "reconciled"
		}); err != nil {
			return latencies, fmt.Errorf("transfer %d did not reconcile: %w", i, err)
		}
		latencies = append(latencies, float64(time.Since(start).Microseconds())/1000)
		current = next
	}
	return latencies, nil
}

func registerDevice(ctx context.Context, c *http.Client, cfg config, name string) (string, error) {
	var out deviceResponse
	if err := postJSON(ctx, c, cfg, "/api/devices/register", map[string]any{
		"name": name,
		"kind": "web",
		"capabilities": map[string]any{
			"platform":        "web",
			"backgroundAudio": false,
			"outputModes":     []string{"browser"},
		},
	}, &out); err != nil {
		return "", err
	}
	id := strings.TrimSpace(out.DeviceID)
	if id == "" {
		id = strings.TrimSpace(out.Device.ID)
	}
	if id == "" {
		return "", errors.New("missing device id")
	}
	return id, nil
}

func transfer(ctx context.Context, c *http.Client, cfg config, deviceID string, resume bool, idempotencySuffix string) (string, error) {
	var out transferResponse
	idempotencyKey := fmt.Sprintf("%s:%s:%s:%d", cfg.userID, deviceID, idempotencySuffix, time.Now().UnixNano())
	if err := postJSONWithHeaders(ctx, c, cfg, "/api/devices/transfer/"+url.PathEscape(deviceID), map[string]any{"resume": resume}, map[string]string{
		"Idempotency-Key": idempotencyKey,
	}, &out); err != nil {
		return "", err
	}
	id := strings.TrimSpace(out.TransferID)
	if id == "" {
		id = strings.TrimSpace(out.Transfer.TransferID)
	}
	if id == "" {
		return "", errors.New("missing transfer id")
	}
	return id, nil
}

func putNowPlaying(ctx context.Context, c *http.Client, cfg config, deviceID string) error {
	return putJSON(ctx, c, cfg, "/api/devices/now-playing", map[string]any{
		"trackId":         "smoke-track",
		"title":           "Device Sync Smoke",
		"artist":          "Earflow",
		"durationSec":     180,
		"isPlaying":       true,
		"positionSec":     12,
		"deviceId":        deviceID,
		"clientSeq":       1,
		"clientEventAtMs": time.Now().UnixMilli(),
	}, nil)
}

func openDeviceWS(ctx context.Context, c *http.Client, cfg config, deviceID, name string) (*wsClient, error) {
	var ticket ticketResponse
	if err := postJSON(ctx, c, cfg, "/api/devices/ws-ticket", map[string]any{"deviceId": deviceID}, &ticket); err != nil {
		return nil, err
	}
	wsURL, err := buildWSURL(cfg.baseURL, ticket.Ticket)
	if err != nil {
		return nil, err
	}
	stepCtx, cancel := context.WithTimeout(ctx, cfg.stepTimeout)
	defer cancel()
	conn, _, err := websocket.Dial(stepCtx, wsURL, &websocket.DialOptions{
		HTTPHeader: authHeaders(cfg),
	})
	if err != nil {
		return nil, err
	}
	readCtx, readCancel := context.WithCancel(ctx)
	client := &wsClient{
		name:   name,
		id:     deviceID,
		conn:   conn,
		frames: make(chan map[string]any, 32),
		errs:   make(chan error, 1),
		cancel: readCancel,
	}
	go client.readLoop(readCtx)
	return client, nil
}

func (c *wsClient) readLoop(ctx context.Context) {
	defer close(c.frames)
	for {
		typ, data, err := c.conn.Read(ctx)
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
		if typ != websocket.MessageText {
			continue
		}
		var frame map[string]any
		if err := json.Unmarshal(data, &frame); err != nil {
			continue
		}
		select {
		case c.frames <- frame:
		case <-ctx.Done():
			return
		}
	}
}

func (c *wsClient) close() {
	if c.cancel != nil {
		c.cancel()
	}
	_ = c.conn.Close(websocket.StatusNormalClosure, "smoke done")
}

func closeClients(clients []*wsClient) {
	for _, client := range clients {
		if client != nil {
			client.close()
		}
	}
}

const (
	CommandTransfer    = "transfer"
	CommandRevokeAudio = "revoke_audio"
)

func expectAndAck(ctx context.Context, cfg config, client *wsClient, cmd, transferID string) error {
	frame, err := waitForFrame(ctx, cfg.stepTimeout, client, func(frame map[string]any) bool {
		payload, _ := frame["payload"].(map[string]any)
		return frame["type"] == "cmd" &&
			frame["cmd"] == cmd &&
			stringField(payload, "transferId") == transferID
	})
	if err != nil {
		return err
	}
	return client.ackCommand(ctx, frame, true, "")
}

func (c *wsClient) ackCommand(ctx context.Context, frame map[string]any, ok bool, reason string) error {
	payload, _ := frame["payload"].(map[string]any)
	if payload == nil {
		return errors.New("command payload missing")
	}
	msg := map[string]any{
		"type":           "cmd:ack",
		"cmd":            frame["cmd"],
		"transferId":     payload["transferId"],
		"commandId":      payload["commandId"],
		"step":           payload["step"],
		"activeRevision": payload["activeRevision"],
		"ok":             ok,
		"reason":         reason,
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	stepCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	return c.conn.Write(stepCtx, websocket.MessageText, data)
}

func waitForFrame(ctx context.Context, timeout time.Duration, c *wsClient, match func(map[string]any) bool) (map[string]any, error) {
	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
	for {
		select {
		case frame, ok := <-c.frames:
			if !ok {
				return nil, errors.New("websocket closed")
			}
			if match(frame) {
				return frame, nil
			}
		case err := <-c.errs:
			return nil, err
		case <-deadline.C:
			return nil, errors.New("timeout")
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
}

func postJSON(ctx context.Context, c *http.Client, cfg config, path string, body any, out any) error {
	return postJSONWithHeaders(ctx, c, cfg, path, body, nil, out)
}

func postJSONWithHeaders(ctx context.Context, c *http.Client, cfg config, path string, body any, headers map[string]string, out any) error {
	return requestJSONWithHeaders(ctx, c, cfg, http.MethodPost, path, body, headers, out)
}

func putJSON(ctx context.Context, c *http.Client, cfg config, path string, body any, out any) error {
	return requestJSONWithHeaders(ctx, c, cfg, http.MethodPut, path, body, nil, out)
}

func requestJSONWithHeaders(ctx context.Context, c *http.Client, cfg config, method, path string, body any, headers map[string]string, out any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	u, err := url.JoinPath(strings.TrimRight(cfg.baseURL, "/"), path)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, method, u, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header = authHeaders(cfg)
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		if strings.TrimSpace(k) != "" && strings.TrimSpace(v) != "" {
			req.Header.Set(k, v)
		}
	}
	resp, err := c.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("%s %s -> %d %s", method, path, resp.StatusCode, strings.TrimSpace(string(data)))
	}
	if out == nil || len(data) == 0 {
		return nil
	}
	return json.Unmarshal(data, out)
}

func buildWSURL(baseURL, ticket string) (string, error) {
	u, err := url.Parse(strings.TrimRight(baseURL, "/"))
	if err != nil {
		return "", err
	}
	switch u.Scheme {
	case "https":
		u.Scheme = "wss"
	default:
		u.Scheme = "ws"
	}
	u.Path = "/ws/devices"
	q := u.Query()
	q.Set("ticket", ticket)
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func authHeaders(cfg config) http.Header {
	h := http.Header{}
	h.Set("X-User-Id", cfg.userID)
	h.Set("X-User-Name", cfg.username)
	return h
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func envDuration(key string, fallback time.Duration) time.Duration {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		var n int
		if _, err := fmt.Sscanf(v, "%d", &n); err == nil {
			return n
		}
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "1", "true", "yes", "y":
		return true
	case "0", "false", "no", "n":
		return false
	default:
		return fallback
	}
}

func stringField(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func percentile(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	if p <= 0 {
		return sorted[0]
	}
	if p >= 100 {
		return sorted[len(sorted)-1]
	}
	rank := (p / 100) * float64(len(sorted)-1)
	lo := int(math.Floor(rank))
	hi := int(math.Ceil(rank))
	if lo == hi {
		return sorted[lo]
	}
	weight := rank - float64(lo)
	return sorted[lo]*(1-weight) + sorted[hi]*weight
}
