package worker

import (
	"context"
	"io"
	"log"
	"os"
	"path/filepath"
	"strconv"
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

func TestRuntimeUsesStoredMaxVisitsAndReportsInfo(t *testing.T) {
	dir := writeRuntimeConfig(t, "", "model.bin.gz", 700)
	engine := &runtimeFakeEngine{}
	runtime, err := NewRuntime(RuntimeOptions{
		Dir:    dir,
		Logger: log.New(io.Discard, "", 0),
		StartLocal: func(context.Context, string, string, string) (katago.Analyzer, error) {
			return engine, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	result, err := runtime.Analyze(context.Background(), katago.Query{ID: "main:0", MaxVisits: 1})
	if err != nil {
		t.Fatal(err)
	}
	if result.RootInfo.Visits != 700 || engine.queries[0].MaxVisits != 700 {
		t.Fatalf("query visits = %#v result=%#v", engine.queries[0], result)
	}
	info := runtime.Info()
	if info.Model != "model.bin.gz" || info.MaxVisits != 700 || info.Backend != "opencl" {
		t.Fatalf("info = %#v", info)
	}
}

func TestRuntimeConfigurePersistsAndRestartsOnModelChange(t *testing.T) {
	dir := writeRuntimeConfig(t, "", "old.bin.gz", 500)
	if err := os.WriteFile(filepath.Join(dir, "model", "new.bin.gz"), []byte("new-model"), 0o644); err != nil {
		t.Fatal(err)
	}
	starts := 0
	first := &runtimeFakeEngine{}
	second := &runtimeFakeEngine{}
	runtime, err := NewRuntime(RuntimeOptions{
		Dir:    dir,
		Logger: log.New(io.Discard, "", 0),
		StartLocal: func(context.Context, string, string, string) (katago.Analyzer, error) {
			starts++
			if starts == 1 {
				return first, nil
			}
			return second, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	info, err := runtime.Configure(context.Background(), RuntimeConfig{Model: "new.bin.gz", MaxVisits: 900})
	if err != nil {
		t.Fatal(err)
	}
	if !first.closed || info.Model != "new.bin.gz" || info.MaxVisits != 900 {
		t.Fatalf("closed=%t info=%#v", first.closed, info)
	}
}

func writeRuntimeConfig(t *testing.T, dir string, model string, maxVisits int) string {
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
  "worker": {"enabled": true, "name": "local-gpu", "url": "ws://127.0.0.1:4380/worker", "token": "dev-token", "model": "` + model + `", "maxVisits": ` + strconv.Itoa(maxVisits) + `},
  "log": {"level": "warn"}
}`)
	if err := os.WriteFile(filepath.Join(dir, "config.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "model", model), []byte("model"), 0o644); err != nil {
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
