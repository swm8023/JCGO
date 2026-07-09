package worker

import (
	"context"
	"errors"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"jcgo/internal/katago"
)

type runtimeFakeEngine struct {
	queries []katago.Query
	closed  bool
}

func (e *runtimeFakeEngine) Analyze(ctx context.Context, query katago.Query) (katago.Result, error) {
	e.queries = append(e.queries, query)
	return katago.Result{ID: query.ID, RootInfo: katago.RootInfo{Visits: query.MaxVisits}}, nil
}

func (e *runtimeFakeEngine) Available() bool { return true }

func (e *runtimeFakeEngine) Status() katago.Status {
	return katago.Status{Available: true}
}

func (e *runtimeFakeEngine) Close() error {
	e.closed = true
	return nil
}

func TestRuntimeUsesAnalyzeConfigAndReportsHardwareInfo(t *testing.T) {
	dir := writeRuntimeConfig(t, "")
	engine := &runtimeFakeEngine{}
	runtime, err := NewRuntime(RuntimeOptions{
		Dir:    dir,
		Logger: log.New(io.Discard, "", 0),
		ProbeHardware: func(context.Context) HardwareInfo {
			return HardwareInfo{CPU: "AMD Ryzen", GPUs: []string{"RTX 4070"}}
		},
		StartLocal: func(ctx context.Context, katagoPath string, modelPath string, configPath string) (katago.Analyzer, error) {
			if filepath.Base(modelPath) != defaultRuntimeModel {
				t.Fatalf("initial model = %q", modelPath)
			}
			return engine, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	result, err := runtime.Analyze(context.Background(), katago.Query{ID: "main:0", MaxVisits: 1}, RuntimeConfig{
		Model:     defaultRuntimeModel,
		MaxVisits: 700,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.RootInfo.Visits != 700 || engine.queries[0].MaxVisits != 700 {
		t.Fatalf("query visits = %#v result=%#v", engine.queries[0], result)
	}
	info := runtime.Info()
	if info.Backend != "opencl" || info.CPU != "AMD Ryzen" || len(info.GPUs) != 1 || info.GPUs[0] != "RTX 4070" {
		t.Fatalf("info = %#v", info)
	}
}

func TestRuntimeAnalyzeRestartsOnModelChangeWithoutPersistingConfig(t *testing.T) {
	dir := writeRuntimeConfig(t, "")
	if err := os.WriteFile(filepath.Join(dir, "model", "new.bin.gz"), []byte("new-model"), 0o644); err != nil {
		t.Fatal(err)
	}
	var starts []string
	first := &runtimeFakeEngine{}
	second := &runtimeFakeEngine{}
	runtime, err := NewRuntime(RuntimeOptions{
		Dir:    dir,
		Logger: log.New(io.Discard, "", 0),
		StartLocal: func(ctx context.Context, katagoPath string, modelPath string, configPath string) (katago.Analyzer, error) {
			starts = append(starts, filepath.Base(modelPath))
			if len(starts) == 1 {
				return first, nil
			}
			return second, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	result, err := runtime.Analyze(context.Background(), katago.Query{ID: "main:1", MaxVisits: 1}, RuntimeConfig{Model: "new.bin.gz", MaxVisits: 900})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(starts, ",") != defaultRuntimeModel+",new.bin.gz" || !first.closed {
		t.Fatalf("starts=%v first.closed=%t", starts, first.closed)
	}
	if result.RootInfo.Visits != 900 || second.queries[0].MaxVisits != 900 {
		t.Fatalf("query visits = %#v result=%#v", second.queries[0], result)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "new.bin.gz") || strings.Contains(string(raw), `"maxVisits": 900`) {
		t.Fatalf("runtime config was persisted unexpectedly: %s", raw)
	}
}

func TestRuntimeIgnoresLegacyWorkerModelInLocalConfig(t *testing.T) {
	dir := writeRuntimeConfig(t, "")
	raw := []byte(`{
  "server": {"enabled": false, "port": 4380, "token": ""},
  "worker": {"enabled": true, "name": "local-gpu", "url": "ws://127.0.0.1:4380/worker", "token": "dev-token", "model": "legacy.bin.gz", "maxVisits": 900},
  "log": {"level": "warn"}
}`)
	if err := os.WriteFile(filepath.Join(dir, "config.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "model", "legacy.bin.gz"), []byte("legacy"), 0o644); err != nil {
		t.Fatal(err)
	}
	var startedModel string
	_, err := NewRuntime(RuntimeOptions{
		Dir:    dir,
		Logger: log.New(io.Discard, "", 0),
		StartLocal: func(ctx context.Context, katagoPath string, modelPath string, configPath string) (katago.Analyzer, error) {
			startedModel = filepath.Base(modelPath)
			return &runtimeFakeEngine{}, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if startedModel != defaultRuntimeModel {
		t.Fatalf("started model = %q, want %q", startedModel, defaultRuntimeModel)
	}
}

func TestRuntimeRetriesModelAfterStartupFailure(t *testing.T) {
	dir := writeRuntimeConfig(t, "")
	starts := 0
	engine := &runtimeFakeEngine{}
	runtime, err := NewRuntime(RuntimeOptions{
		Dir:    dir,
		Logger: log.New(io.Discard, "", 0),
		StartLocal: func(ctx context.Context, katagoPath string, modelPath string, configPath string) (katago.Analyzer, error) {
			starts++
			if starts == 1 {
				return nil, errors.New("startup failed")
			}
			return engine, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	result, err := runtime.Analyze(context.Background(), katago.Query{ID: "main:2", MaxVisits: 1}, RuntimeConfig{
		Model:     defaultRuntimeModel,
		MaxVisits: 600,
	})
	if err != nil {
		t.Fatal(err)
	}
	if starts != 2 || result.RootInfo.Visits != 600 {
		t.Fatalf("starts=%d result=%#v", starts, result)
	}
}

func writeRuntimeConfig(t *testing.T, dir string) string {
	t.Helper()
	if dir == "" {
		dir = t.TempDir()
	}
	for _, path := range []string{
		filepath.Join(dir, "bin"),
		filepath.Join(dir, "config"),
		filepath.Join(dir, "model"),
	} {
		if err := os.MkdirAll(path, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	raw := []byte(`{
  "server": {"enabled": false, "port": 4380, "token": ""},
  "worker": {"enabled": true, "name": "local-gpu", "url": "ws://127.0.0.1:4380/worker", "token": "dev-token"},
  "log": {"level": "warn"}
}`)
	if err := os.WriteFile(filepath.Join(dir, "config.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "model", defaultRuntimeModel), []byte("model"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "config", "analysis_config.cfg"), []byte("analysis"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "config", "katago_backend.json"), []byte(`{"id":"opencl","label":"OpenCL"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}
