package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadDirReadsStrictConfigAndDerivesRuntimePaths(t *testing.T) {
	dir := t.TempDir()
	raw := []byte(`{
  "server": {"enabled": true, "port": 4380, "token": "server-token"},
  "worker": {"enabled": true, "name": "local-gpu", "url": "ws://127.0.0.1:4380/worker", "token": "worker-token", "model": "model.bin.gz", "maxVisits": 700},
  "log": {"level": "debug"}
}`)
	if err := os.WriteFile(filepath.Join(dir, "config.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}

	cfg, err := LoadDir(dir)
	if err != nil {
		t.Fatalf("LoadDir returned error: %v", err)
	}

	if cfg.Dir != filepath.Clean(dir) {
		t.Fatalf("Dir = %q", cfg.Dir)
	}
	if cfg.ListenAddr != "127.0.0.1:4380" || cfg.AccessToken != "server-token" {
		t.Fatalf("server derivation = %#v", cfg)
	}
	if cfg.Worker.Name != "local-gpu" || cfg.Worker.MaxVisits != 700 {
		t.Fatalf("worker = %#v", cfg.Worker)
	}
	if cfg.DatabasePath != filepath.Join(dir, "db", "jcgo.sqlite") {
		t.Fatalf("DatabasePath = %q", cfg.DatabasePath)
	}
	if cfg.GamesDir != filepath.Join(dir, "games") {
		t.Fatalf("GamesDir = %q", cfg.GamesDir)
	}
	if cfg.WebDir != filepath.Join(dir, "web") {
		t.Fatalf("WebDir = %q", cfg.WebDir)
	}
	if cfg.KatagoPath != filepath.Join(dir, "bin", exeName("katago")) {
		t.Fatalf("KatagoPath = %q", cfg.KatagoPath)
	}
	if cfg.ModelPath != filepath.Join(dir, "model", "model.bin.gz") {
		t.Fatalf("ModelPath = %q", cfg.ModelPath)
	}
	if cfg.AnalysisConfigPath != filepath.Join(dir, "config", "analysis_config.cfg") {
		t.Fatalf("AnalysisConfigPath = %q", cfg.AnalysisConfigPath)
	}
	if cfg.ServerLogPath != filepath.Join(dir, "log", "server.log") || cfg.WorkerLogPath != filepath.Join(dir, "log", "worker.log") {
		t.Fatalf("log paths = %q %q", cfg.ServerLogPath, cfg.WorkerLogPath)
	}
}

func TestLoadDirRejectsMissingConfig(t *testing.T) {
	_, err := LoadDir(t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "config file not found") {
		t.Fatalf("err = %v", err)
	}
}

func TestLoadDirRejectsUnknownFields(t *testing.T) {
	dir := t.TempDir()
	raw := []byte(`{
  "server": {"enabled": true, "port": 4380, "token": "server-token", "extra": true},
  "worker": {"enabled": false, "name": "", "url": "", "token": "", "model": "", "maxVisits": 500},
  "log": {"level": "warn"}
}`)
	if err := os.WriteFile(filepath.Join(dir, "config.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := LoadDir(dir)
	if err == nil || !strings.Contains(err.Error(), `unknown field "extra"`) {
		t.Fatalf("err = %v", err)
	}
}

func TestLoadDirValidatesEnabledSections(t *testing.T) {
	dir := t.TempDir()
	raw := []byte(`{
  "server": {"enabled": true, "port": 0, "token": ""},
  "worker": {"enabled": true, "name": "", "url": "", "token": "", "model": "", "maxVisits": 0},
  "log": {"level": "warn"}
}`)
	if err := os.WriteFile(filepath.Join(dir, "config.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := LoadDir(dir)
	if err == nil {
		t.Fatal("expected validation error")
	}
	for _, want := range []string{"server.port", "server.token", "worker.name", "worker.url", "worker.token", "worker.maxVisits"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("err = %v, missing %s", err, want)
		}
	}
}

func TestEnsureDirsCreatesRuntimeDirectories(t *testing.T) {
	dir := t.TempDir()
	cfg := Config{
		Dir:                dir,
		DatabasePath:       filepath.Join(dir, "db", "jcgo.sqlite"),
		GamesDir:           filepath.Join(dir, "games"),
		WebDir:             filepath.Join(dir, "web"),
		ServerLogPath:      filepath.Join(dir, "log", "server.log"),
		WorkerLogPath:      filepath.Join(dir, "log", "worker.log"),
		KatagoPath:         filepath.Join(dir, "bin", exeName("katago")),
		ModelPath:          filepath.Join(dir, "model", "model.bin.gz"),
		AnalysisConfigPath: filepath.Join(dir, "config", "analysis_config.cfg"),
	}

	if err := EnsureDirs(cfg); err != nil {
		t.Fatalf("EnsureDirs returned error: %v", err)
	}

	for _, path := range []string{
		filepath.Join(dir, "bin"),
		filepath.Join(dir, "db"),
		filepath.Join(dir, "games"),
		filepath.Join(dir, "log"),
		filepath.Join(dir, "model"),
		filepath.Join(dir, "config"),
		filepath.Join(dir, "web"),
	} {
		if info, err := os.Stat(path); err != nil || !info.IsDir() {
			t.Fatalf("dir %s stat = %v info=%#v", path, err, info)
		}
	}
}

func TestUpdateWorkerRuntimePreservesSharedConfig(t *testing.T) {
	dir := t.TempDir()
	raw := []byte(`{
  "server": {"enabled": true, "port": 4380, "token": "server-token"},
  "worker": {"enabled": true, "name": "local-gpu", "url": "ws://127.0.0.1:4380/worker", "token": "worker-token", "model": "old.bin.gz", "maxVisits": 500},
  "log": {"level": "debug"}
}`)
	if err := os.WriteFile(filepath.Join(dir, "config.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}

	if err := UpdateWorkerRuntime(dir, "new.bin.gz", 1000); err != nil {
		t.Fatalf("UpdateWorkerRuntime returned error: %v", err)
	}
	cfg, err := LoadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Server.Token != "server-token" || cfg.Worker.Token != "worker-token" {
		t.Fatalf("config lost existing fields: %#v", cfg)
	}
	if cfg.Worker.Model != "new.bin.gz" || cfg.Worker.MaxVisits != 1000 {
		t.Fatalf("worker runtime = %#v", cfg.Worker)
	}
}
