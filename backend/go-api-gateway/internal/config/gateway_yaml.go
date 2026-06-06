package config

import (
	"errors"
	"os"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

type MatchType string

type Match struct {
	Type   MatchType `yaml:"type"`
	Value  string    `yaml:"value"`
	Values []string  `yaml:"values"`
}

type Policies struct {
	Class                     string            `yaml:"class"`
	RequireUser               bool              `yaml:"require_user"`
	RequireServiceToken       bool              `yaml:"require_service_token"`
	RateLimit                 string            `yaml:"rate_limit"`
	Timeout                   string            `yaml:"timeout"`
	StripAuth                 bool              `yaml:"strip_auth"`
	WebSocket                 bool              `yaml:"websocket"`
	ResponseCache             string            `yaml:"response_cache"`
	ResponseCacheNamespace    string            `yaml:"response_cache_namespace"`
	InvalidateCacheNamespaces []string          `yaml:"invalidate_cache_namespaces"`
	SetResponseHeaders        map[string]string `yaml:"set_response_headers"`
}

type Route struct {
	ID       string   `yaml:"id"`
	Methods  []string `yaml:"methods"`
	Match    Match    `yaml:"match"`
	Upstream string   `yaml:"upstream"`
	Rewrite  string   `yaml:"rewrite"`
	Policies Policies `yaml:"policies"`
}

type GatewayYAML struct {
	Routes []Route `yaml:"routes"`
}

func LoadGatewayYAML(path string) (GatewayYAML, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return GatewayYAML{}, err
	}
	var cfg GatewayYAML
	if err := yaml.Unmarshal(b, &cfg); err != nil {
		return GatewayYAML{}, err
	}
	if len(cfg.Routes) == 0 {
		return GatewayYAML{}, errors.New("no routes")
	}
	seenIDs := make(map[string]struct{}, len(cfg.Routes))
	for i := range cfg.Routes {
		r := &cfg.Routes[i]
		r.ID = strings.TrimSpace(r.ID)
		r.Upstream = strings.TrimSpace(r.Upstream)
		if r.ID == "" || r.Upstream == "" {
			return GatewayYAML{}, errors.New("invalid route")
		}
		if _, ok := seenIDs[r.ID]; ok {
			return GatewayYAML{}, errors.New("duplicate route id")
		}
		seenIDs[r.ID] = struct{}{}
		if r.Match.Type == "" {
			return GatewayYAML{}, errors.New("route match.type is required")
		}
		switch strings.ToLower(string(r.Match.Type)) {
		case "exact", "regex":
			if strings.TrimSpace(r.Match.Value) == "" {
				return GatewayYAML{}, errors.New("route match.value is required")
			}
		case "prefix":
			if strings.TrimSpace(r.Match.Value) == "" && len(r.Match.Values) == 0 {
				return GatewayYAML{}, errors.New("route match value is required")
			}
		default:
			return GatewayYAML{}, errors.New("invalid route match.type")
		}
		if raw := strings.TrimSpace(r.Policies.Timeout); raw != "" {
			d, err := time.ParseDuration(raw)
			if err != nil || d <= 0 {
				return GatewayYAML{}, errors.New("invalid route timeout")
			}
		}
	}
	return cfg, nil
}
