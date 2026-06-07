package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

const (
	headerServiceToken = "X-Service-Token"
	internalPrefix     = "/internal/auth/v1"
)

// SoTClient syncs auth state to security-service Postgres SoT (best-effort on upsert).
type SoTClient struct {
	baseURL     string
	serviceKey  string
	mode        SoTMode
	hc          http.Client
	log         *slog.Logger
}

type SoTClientConfig struct {
	SecurityBaseURL string
	ServiceKey      string
	Mode            SoTMode
	Logger          *slog.Logger
}

func NewSoTClient(cfg SoTClientConfig) *SoTClient {
	base := strings.TrimRight(strings.TrimSpace(cfg.SecurityBaseURL), "/")
	key := strings.TrimSpace(cfg.ServiceKey)
	if base == "" || key == "" {
		return nil
	}
	log := cfg.Logger
	if log == nil {
		log = slog.Default()
	}
	return &SoTClient{
		baseURL:    base,
		serviceKey: key,
		mode:       cfg.Mode,
		hc:         http.Client{Timeout: 5 * time.Second},
		log:        log,
	}
}

func (c *SoTClient) WritesEnabled() bool {
	return c != nil && c.mode.WritesEnabled()
}

func (c *SoTClient) UpsertSession(ctx context.Context, sid string, userID int64, refreshJTI, ip, ua string) {
	if c == nil || !c.WritesEnabled() {
		return
	}
	body, _ := json.Marshal(map[string]any{
		"sid": sid, "userId": userID, "refreshJti": refreshJTI, "ip": ip, "userAgent": ua,
	})
	if err := c.post(ctx, internalPrefix+"/sessions/upsert", body, false); err != nil {
		c.log.Warn("auth pg sot session upsert failed", "err", err, "sid", sid)
	}
}

func (c *SoTClient) UpsertDevice(ctx context.Context, authDeviceID, sid string, userID int64, publicKeySPki, ua string) {
	if c == nil || !c.WritesEnabled() {
		return
	}
	body, _ := json.Marshal(map[string]any{
		"authDeviceId": authDeviceID, "sid": sid, "userId": userID,
		"publicKeySpki": publicKeySPki, "userAgent": ua,
	})
	if err := c.post(ctx, internalPrefix+"/devices/upsert", body, false); err != nil {
		c.log.Warn("auth pg sot device upsert failed", "err", err, "authDeviceId", authDeviceID)
	}
}

func (c *SoTClient) RevokeSession(ctx context.Context, sid string, userID int64, jti string) error {
	if c == nil || !c.WritesEnabled() {
		return nil
	}
	body, _ := json.Marshal(map[string]any{"sid": sid, "userId": userID, "jti": jti})
	return c.post(ctx, internalPrefix+"/sessions/revoke", body, true)
}

// ProofEpochLookup mirrors security-service internal epochs lookup response.
type ProofEpochLookup struct {
	SessionEpoch   int64 `json:"sessionEpoch"`
	DeviceEpoch    int64 `json:"deviceEpoch"`
	SessionRevoked bool  `json:"sessionRevoked"`
	DeviceRevoked  bool  `json:"deviceRevoked"`
}

func (c *SoTClient) LookupProofEpochs(ctx context.Context, sid, authDeviceID string) (ProofEpochLookup, error) {
	if c == nil {
		return ProofEpochLookup{}, fmt.Errorf("sot client unavailable")
	}
	body, _ := json.Marshal(map[string]string{
		"sid":          strings.TrimSpace(sid),
		"authDeviceId": strings.TrimSpace(authDeviceID),
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+internalPrefix+"/epochs/lookup", bytes.NewReader(body))
	if err != nil {
		return ProofEpochLookup{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(headerServiceToken, c.serviceKey)

	resp, err := c.hc.Do(req)
	if err != nil {
		return ProofEpochLookup{}, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8*1024))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ProofEpochLookup{}, fmt.Errorf("security epochs lookup status %d", resp.StatusCode)
	}
	var out ProofEpochLookup
	if err := json.Unmarshal(raw, &out); err != nil {
		return ProofEpochLookup{}, err
	}
	return out, nil
}

func (c *SoTClient) post(ctx context.Context, path string, body []byte, failOnError bool) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(headerServiceToken, c.serviceKey)

	resp, err := c.hc.Do(req)
	if err != nil {
		if failOnError {
			return err
		}
		return nil
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 8*1024))
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	if failOnError {
		return fmt.Errorf("security sot %s status %d", path, resp.StatusCode)
	}
	return nil
}
