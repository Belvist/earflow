package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type TokenManagerConfig struct {
	ServiceName string
	ServiceKey  string
	Endpoint    string
}

type ServiceTokenManager struct {
	cfg TokenManagerConfig
	mu  sync.Mutex
	cur cachedToken
	hc  http.Client
}

type cachedToken struct {
	Token string
	Exp   time.Time
}

type tokenResp struct {
	Token     string `json:"token"`
	ExpiresAt string `json:"expiresAt"`
	Service   string `json:"serviceName"`
}

type tokenReq struct {
	ServiceName string `json:"serviceName"`
	ServiceKey  string `json:"serviceKey"`
}

func NewServiceTokenManager(cfg TokenManagerConfig) *ServiceTokenManager {
	return &ServiceTokenManager{
		cfg: cfg,
		hc: http.Client{
			Timeout: 5 * time.Second,
		},
	}
}

func (m *ServiceTokenManager) GetToken(ctx context.Context) (string, error) {
	m.mu.Lock()
	cur := m.cur
	m.mu.Unlock()

	if cur.Token != "" && time.Until(cur.Exp) > 10*time.Second {
		return cur.Token, nil
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	cur = m.cur
	if cur.Token != "" && time.Until(cur.Exp) > 10*time.Second {
		return cur.Token, nil
	}

	if m.cfg.Endpoint == "" || m.cfg.ServiceName == "" || m.cfg.ServiceKey == "" {
		return "", errors.New("service token manager misconfigured")
	}

	payload, _ := json.Marshal(tokenReq{ServiceName: m.cfg.ServiceName, ServiceKey: m.cfg.ServiceKey})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, m.cfg.Endpoint, bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := m.hc.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", errors.New("service token request failed")
	}

	var tr tokenResp
	dec := json.NewDecoder(resp.Body)
	if err := dec.Decode(&tr); err != nil {
		return "", err
	}
	if tr.Token == "" {
		return "", errors.New("empty service token")
	}

	parser := jwt.NewParser()
	claims := jwt.MapClaims{}
	_, _, _ = parser.ParseUnverified(tr.Token, claims)

	exp := time.Now().Add(5 * time.Minute)
	if raw, ok := claims["exp"]; ok {
		if fv, ok := raw.(float64); ok {
			t := time.Unix(int64(fv), 0)
			if !t.IsZero() {
				exp = t
			}
		}
	}

	m.cur = cachedToken{Token: tr.Token, Exp: exp}
	return tr.Token, nil
}
