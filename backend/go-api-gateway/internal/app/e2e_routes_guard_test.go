package app

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

var productionGatewaySourceFiles = []string{
	"internal/app/server.go",
	"internal/auth/http_routes.go",
	"cmd/gateway/main.go",
}

func TestProductionGatewaySourceMustNotRegisterE2ERoutes(t *testing.T) {
	moduleRoot := gatewayModuleRoot(t)

	for _, rel := range productionGatewaySourceFiles {
		path := filepath.Join(moduleRoot, rel)
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", rel, err)
		}
		content := string(data)
		for _, forbidden := range []string{
			"/e2e/seed-session",
			"/e2e/fixture.html",
			"handleSeedSession",
			"StartPopE2EHarness",
		} {
			if strings.Contains(content, forbidden) {
				t.Fatalf("%s must not register PoP e2e harness routes (%q); use cmd/pop-e2e-harness with -tags pop_e2e_harness", rel, forbidden)
			}
		}
	}
}

func TestProductionGatewaySourceExcludesPopE2EHarnessBuildTag(t *testing.T) {
	moduleRoot := gatewayModuleRoot(t)
	authDir := filepath.Join(moduleRoot, "internal", "auth")

	entries, err := os.ReadDir(authDir)
	if err != nil {
		t.Fatal(err)
	}

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") {
			continue
		}
		if entry.Name() == "pop_e2e_harness.go" || entry.Name() == "pop_e2e_harness_test.go" {
			data, err := os.ReadFile(filepath.Join(authDir, entry.Name()))
			if err != nil {
				t.Fatal(err)
			}
			if !strings.HasPrefix(string(data), "//go:build pop_e2e_harness") {
				t.Fatalf("%s must have //go:build pop_e2e_harness guard", entry.Name())
			}
		}
	}
}

func TestProductionGatewayBinaryExcludesE2EHarnessStrings(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping binary guard in -short mode")
	}

	moduleRoot := gatewayModuleRoot(t)
	out := filepath.Join(t.TempDir(), "gateway"+binaryExt())

	cmd := exec.Command("go", "build", "-trimpath", "-o", out, "./cmd/gateway")
	cmd.Dir = moduleRoot
	if outBytes, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("go build gateway: %v\n%s", err, outBytes)
	}

	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}

	for _, needle := range []string{
		"seed-session",
		"/e2e/fixture.html",
		"pop-e2e-secret",
	} {
		if bytes.Contains(data, []byte(needle)) {
			t.Fatalf("production gateway binary must not contain %q (e2e harness leak)", needle)
		}
	}
}

func gatewayModuleRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	// internal/app -> module root
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", ".."))
}

func binaryExt() string {
	if runtime.GOOS == "windows" {
		return ".exe"
	}
	return ""
}
