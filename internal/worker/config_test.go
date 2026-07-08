package worker

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadOrCreateConfigCreatesTemplateWhenMissing(t *testing.T) {
	path := filepath.Join(t.TempDir(), "jcgo-worker.json")

	cfg, created, err := LoadOrCreateConfig(path)
	if err != nil {
		t.Fatalf("LoadOrCreateConfig returned error: %v", err)
	}
	if !created {
		t.Fatal("created = false")
	}
	if cfg != (Config{}) {
		t.Fatalf("cfg = %#v", cfg)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != string(ExampleConfigJSON()) {
		t.Fatalf("template = %s", raw)
	}
}

func TestLoadOrCreateConfigReadsExistingConfig(t *testing.T) {
	path := filepath.Join(t.TempDir(), "jcgo-worker.json")
	data := []byte(`{
  "serverUrl": "ws://127.0.0.1:4380/worker",
  "accessToken": "secret",
  "workerName": "gpu-worker-1",
  "katagoPath": "D:\\KataGo\\katago.exe",
  "modelPath": "D:\\KataGo\\model.bin.gz",
  "analysisConfigPath": "D:\\KataGo\\analysis_config.cfg"
}`)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}

	cfg, created, err := LoadOrCreateConfig(path)
	if err != nil {
		t.Fatalf("LoadOrCreateConfig returned error: %v", err)
	}
	if created {
		t.Fatal("created = true")
	}
	if cfg.ServerURL != "ws://127.0.0.1:4380/worker" || cfg.AccessToken != "secret" || cfg.WorkerName != "gpu-worker-1" {
		t.Fatalf("cfg = %#v", cfg)
	}
	if missing := cfg.MissingFields(); len(missing) != 0 {
		t.Fatalf("missing = %v", missing)
	}
}

func TestConfigMissingFields(t *testing.T) {
	cfg := Config{ServerURL: "ws://127.0.0.1:4380/worker", AccessToken: "secret"}

	missing := cfg.MissingFields()
	want := []string{"workerName", "katagoPath", "modelPath", "analysisConfigPath"}
	if len(missing) != len(want) {
		t.Fatalf("missing = %v", missing)
	}
	for i := range want {
		if missing[i] != want[i] {
			t.Fatalf("missing = %v, want %v", missing, want)
		}
	}
}
