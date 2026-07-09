package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestConfigPathUsesDirFlag(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "state")
	got := configDirFromArgs([]string{"--dir", dir})
	if got != dir {
		t.Fatalf("dir = %q, want %q", got, dir)
	}
}

func TestConfigPathDefaultsToHomeJCGO(t *testing.T) {
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)
	got := configDirFromArgs(nil)
	if filepath.Base(got) != ".jcgo" {
		t.Fatalf("dir = %q", got)
	}
}

func TestServerDisabledReturnsWithoutListen(t *testing.T) {
	dir := t.TempDir()
	raw := []byte(`{
  "server": {"enabled": false, "port": 4380, "token": ""},
  "worker": {"enabled": false, "name": "", "url": "", "token": "", "model": "", "maxVisits": 500},
  "log": {"level": "warn"}
}`)
	if err := os.WriteFile(filepath.Join(dir, "config.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := run([]string{"--dir", dir}); err != nil {
		t.Fatalf("run returned error: %v", err)
	}
}
