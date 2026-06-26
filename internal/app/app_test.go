package app

import (
	"context"
	"path/filepath"
	"testing"

	"jcgo/internal/config"
)

func TestNewAppStartsWithUnavailableEngineWhenPathsMissing(t *testing.T) {
	dataDir := t.TempDir()
	cfg := config.Config{
		AccessToken:  "secret",
		DataDir:      dataDir,
		DatabasePath: filepath.Join(dataDir, "jcgo.sqlite"),
		GamesDir:     filepath.Join(dataDir, "games"),
		MaxVisits:    500,
	}
	app, err := New(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	if app.EngineStatus().Available {
		t.Fatal("engine should be unavailable without configured paths")
	}
	if app.RPC == nil || app.Scheduler == nil {
		t.Fatalf("app = %#v", app)
	}
}
