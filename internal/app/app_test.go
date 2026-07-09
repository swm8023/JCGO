package app

import (
	"context"
	"path/filepath"
	"testing"

	"jcgo/internal/config"
)

func TestNewAppStartsWithWorkerOnlyUnavailableEngine(t *testing.T) {
	dir := t.TempDir()
	cfg := config.Config{
		AccessToken:  "secret",
		Dir:          dir,
		DatabasePath: filepath.Join(dir, "jcgo.sqlite"),
		GamesDir:     filepath.Join(dir, "games"),
	}
	app, err := New(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	if app.EngineStatus().Available {
		t.Fatal("engine should be unavailable without connected workers")
	}
	if app.Workers == nil {
		t.Fatal("workers should be configured")
	}
	if app.RPC == nil || app.Scheduler == nil {
		t.Fatalf("app = %#v", app)
	}
}
