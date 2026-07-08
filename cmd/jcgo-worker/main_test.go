package main

import (
	"bytes"
	"context"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"jcgo/internal/katago"
	"jcgo/internal/worker"
)

func TestRunCreatesConfigTemplateAndExits(t *testing.T) {
	dir := t.TempDir()
	var logs bytes.Buffer

	err := run(context.Background(), runOptions{
		Dir:    dir,
		Logger: log.New(&logs, "", 0),
		StartLocal: func(context.Context, string, string, string) (katago.Analyzer, error) {
			t.Fatal("StartLocal should not be called when config is created")
			return nil, nil
		},
		ServeConnection: func(context.Context, string, string, worker.Info, katago.Analyzer) error {
			t.Fatal("ServeConnection should not be called when config is created")
			return nil
		},
		Sleep: func(time.Duration) {},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "jcgo-worker.json")); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(logs.String(), "created config template") {
		t.Fatalf("logs = %q", logs.String())
	}
}
