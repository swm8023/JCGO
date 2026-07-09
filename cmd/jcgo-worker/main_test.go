package main

import (
	"bytes"
	"context"
	"errors"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"jcgo/internal/katago"
	"jcgo/internal/worker"
)

func TestRunReturnsErrorWhenSharedConfigIsMissing(t *testing.T) {
	err := run(context.Background(), runOptions{
		Dir:    t.TempDir(),
		Logger: log.New(&bytes.Buffer{}, "", 0),
		Sleep:  func(time.Duration) {},
	})
	if err == nil || !strings.Contains(err.Error(), "config file not found") {
		t.Fatalf("err = %v", err)
	}
}

func TestRunConnectsWithRuntimeInfo(t *testing.T) {
	dir := t.TempDir()
	writeConfig(t, dir)
	var gotKatago, gotModel, gotAnalysis string
	var gotInfo worker.Info

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	err := run(ctx, runOptions{
		Dir:    dir,
		Logger: log.New(&bytes.Buffer{}, "", 0),
		StartLocal: func(ctx context.Context, katagoPath string, modelPath string, configPath string) (katago.Analyzer, error) {
			gotKatago, gotModel, gotAnalysis = katagoPath, modelPath, configPath
			return staticAnalyzer{status: katago.Status{Available: true}}, nil
		},
		ServeConnection: func(ctx context.Context, serverURL string, token string, runtime worker.ClientRuntime) error {
			gotInfo = runtime.Info()
			cancel()
			return context.Canceled
		},
		Sleep: func(time.Duration) {},
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
	if gotKatago != filepath.Join(dir, "bin", "katago.exe") {
		t.Fatalf("katago = %q", gotKatago)
	}
	if gotModel != filepath.Join(dir, "model", "kata1-b18c384nbt-s9996604416-d4316597426.bin.gz") {
		t.Fatalf("model = %q", gotModel)
	}
	if gotAnalysis != filepath.Join(dir, "config", "analysis_config.cfg") {
		t.Fatalf("analysis config = %q", gotAnalysis)
	}
	if gotInfo.Name != "local-gpu" || gotInfo.Backend != "unknown" || gotInfo.Error != "" {
		t.Fatalf("info=%#v", gotInfo)
	}
}

func TestRunRegistersUnavailableEngineStatusAfterStart(t *testing.T) {
	dir := t.TempDir()
	writeConfig(t, dir)
	var gotInfo worker.Info

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	err := run(ctx, runOptions{
		Dir:    dir,
		Logger: log.New(&bytes.Buffer{}, "", 0),
		StartLocal: func(context.Context, string, string, string) (katago.Analyzer, error) {
			return staticAnalyzer{status: katago.Status{Available: false, Error: "katago exited: missing runtime dependency"}}, nil
		},
		ServeConnection: func(ctx context.Context, serverURL string, token string, runtime worker.ClientRuntime) error {
			gotInfo = runtime.Info()
			cancel()
			return context.Canceled
		},
		Sleep: func(time.Duration) {},
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
	if !strings.Contains(gotInfo.Error, "missing runtime dependency") {
		t.Fatalf("info = %#v", gotInfo)
	}
}

func TestRunUsesDefaultModelWhenWorkerConfigHasNoModel(t *testing.T) {
	dir := t.TempDir()
	var gotInfo worker.Info
	var gotModel string
	writeConfig(t, dir)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	err := run(ctx, runOptions{
		Dir:    dir,
		Logger: log.New(&bytes.Buffer{}, "", 0),
		StartLocal: func(ctx context.Context, katagoPath string, modelPath string, configPath string) (katago.Analyzer, error) {
			gotModel = filepath.Base(modelPath)
			return staticAnalyzer{status: katago.Status{Available: true}}, nil
		},
		ServeConnection: func(ctx context.Context, serverURL string, token string, runtime worker.ClientRuntime) error {
			gotInfo = runtime.Info()
			cancel()
			return context.Canceled
		},
		Sleep: func(time.Duration) {},
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
	if gotInfo.Name != "local-gpu" || gotModel != "kata1-b18c384nbt-s9996604416-d4316597426.bin.gz" || gotInfo.Error != "" {
		t.Fatalf("info = %#v", gotInfo)
	}
}

func writeConfig(t *testing.T, dir string) {
	t.Helper()
	raw := `{
  "server": {"enabled": false, "port": 4380, "token": ""},
  "worker": {"enabled": true, "name": "local-gpu", "url": "ws://127.0.0.1:4380/worker", "token": "dev-token"},
  "log": {"level": "warn"}
}`
	if err := os.WriteFile(filepath.Join(dir, "config.json"), []byte(raw), 0o644); err != nil {
		t.Fatal(err)
	}
}

type staticAnalyzer struct {
	status katago.Status
}

func (a staticAnalyzer) Analyze(context.Context, katago.Query) (katago.Result, error) {
	return katago.Result{}, errors.New("not used")
}

func (a staticAnalyzer) Available() bool {
	return a.status.Available
}

func (a staticAnalyzer) Status() katago.Status {
	return a.status
}

func (a staticAnalyzer) Close() error {
	return nil
}
