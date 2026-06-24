package config

import (
	"path/filepath"
	"testing"
)

func TestLoadDefaultsFromEnvironment(t *testing.T) {
	t.Setenv("JCGO_ACCESS_TOKEN", "secret-token")
	t.Setenv("JCGO_DATA_DIR", t.TempDir())
	t.Setenv("JCGO_KATAGO_PATH", filepath.Join("bin", "katago"))
	t.Setenv("JCGO_MODEL_PATH", filepath.Join("models", "kata.bin.gz"))
	t.Setenv("JCGO_ANALYSIS_CONFIG_PATH", filepath.Join("cfg", "analysis.cfg"))

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.AccessToken != "secret-token" {
		t.Fatalf("AccessToken = %q", cfg.AccessToken)
	}
	if cfg.ListenAddr != "127.0.0.1:4380" {
		t.Fatalf("ListenAddr = %q", cfg.ListenAddr)
	}
	if cfg.MaxVisits != 500 {
		t.Fatalf("MaxVisits = %d", cfg.MaxVisits)
	}
}

func TestLoadRejectsMissingToken(t *testing.T) {
	t.Setenv("JCGO_ACCESS_TOKEN", "")
	_, err := Load()
	if err == nil {
		t.Fatal("Load returned nil error for missing token")
	}
}
