package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRepositoryGatewayYAMLFilesLoad(t *testing.T) {
	for _, name := range []string{"gateway.yaml", "gateway.artist.yaml"} {
		t.Run(name, func(t *testing.T) {
			cfg, err := LoadGatewayYAML(filepath.Join("..", "..", name))
			if err != nil {
				t.Fatalf("LoadGatewayYAML(%s) returned error: %v", name, err)
			}
			if len(cfg.Routes) == 0 {
				t.Fatalf("LoadGatewayYAML(%s) returned no routes", name)
			}
		})
	}
}

func TestLoadGatewayYAMLRejectsDuplicateRouteIDs(t *testing.T) {
	path := writeGatewayYAMLFixture(t, `
routes:
  - id: dup
    match:
      type: exact
      value: /one
    upstream: auth
  - id: dup
    match:
      type: exact
      value: /two
    upstream: auth
`)

	if _, err := LoadGatewayYAML(path); err == nil {
		t.Fatal("LoadGatewayYAML returned nil error for duplicate route ids")
	}
}

func TestLoadGatewayYAMLRejectsInvalidTimeout(t *testing.T) {
	path := writeGatewayYAMLFixture(t, `
routes:
  - id: bad_timeout
    match:
      type: exact
      value: /one
    upstream: auth
    policies:
      timeout: tomorrow
`)

	if _, err := LoadGatewayYAML(path); err == nil {
		t.Fatal("LoadGatewayYAML returned nil error for invalid timeout")
	}
}

func TestRepositoryUnsafeRoutesHaveExplicitTimeouts(t *testing.T) {
	for _, name := range []string{"gateway.yaml", "gateway.artist.yaml"} {
		t.Run(name, func(t *testing.T) {
			cfg, err := LoadGatewayYAML(filepath.Join("..", "..", name))
			if err != nil {
				t.Fatalf("LoadGatewayYAML(%s) returned error: %v", name, err)
			}

			for _, route := range cfg.Routes {
				class := strings.ToLower(strings.TrimSpace(route.Policies.Class))
				if class != "unsafe" && class != "auth_only" {
					continue
				}
				if strings.TrimSpace(route.Policies.Timeout) == "" {
					t.Fatalf("%s route %q class=%q has no explicit timeout", name, route.ID, class)
				}
			}
		})
	}
}

func TestArtistPortalTrackUploadTimeoutBudget(t *testing.T) {
	cfg, err := LoadGatewayYAML(filepath.Join("..", "..", "gateway.artist.yaml"))
	if err != nil {
		t.Fatalf("LoadGatewayYAML(gateway.artist.yaml) returned error: %v", err)
	}

	for _, route := range cfg.Routes {
		if route.ID != "artist_portal_tracks_upload" {
			continue
		}
		d, err := time.ParseDuration(route.Policies.Timeout)
		if err != nil {
			t.Fatalf("artist_portal_tracks_upload timeout does not parse: %v", err)
		}
		if d < 120*time.Second {
			t.Fatalf("artist_portal_tracks_upload timeout = %s, want at least 120s", d)
		}
		return
	}

	t.Fatal("gateway.artist.yaml has no artist_portal_tracks_upload route")
}

func writeGatewayYAMLFixture(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "gateway.yaml")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	return path
}
