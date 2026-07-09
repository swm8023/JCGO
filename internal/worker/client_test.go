package worker

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"jcgo/internal/katago"
)

type clientFakeAnalyzer struct {
	progress bool
}

type clientBasicAnalyzer struct{}

type clientRecordingAnalyzer struct {
	queries chan katago.Query
}

func (a clientBasicAnalyzer) Analyze(ctx context.Context, query katago.Query) (katago.Result, error) {
	return katago.Result{ID: query.ID, RootInfo: katago.RootInfo{Visits: 88}}, nil
}

func (a clientBasicAnalyzer) Available() bool { return true }

func (a clientBasicAnalyzer) Status() katago.Status {
	return katago.Status{Available: true}
}

func (a clientBasicAnalyzer) Close() error { return nil }

func (a clientRecordingAnalyzer) Analyze(ctx context.Context, query katago.Query) (katago.Result, error) {
	a.queries <- query
	return katago.Result{ID: query.ID, RootInfo: katago.RootInfo{Visits: query.MaxVisits}}, nil
}

func (a clientRecordingAnalyzer) Available() bool { return true }

func (a clientRecordingAnalyzer) Status() katago.Status {
	return katago.Status{Available: true}
}

func (a clientRecordingAnalyzer) Close() error { return nil }

func (a clientFakeAnalyzer) Analyze(ctx context.Context, query katago.Query) (katago.Result, error) {
	return katago.Result{ID: query.ID, RootInfo: katago.RootInfo{Visits: 88}}, nil
}

func (a clientFakeAnalyzer) AnalyzeWithProgress(ctx context.Context, query katago.Query, progress func(katago.Result)) (katago.Result, error) {
	if a.progress {
		progress(katago.Result{ID: query.ID, IsDuringSearch: true, RootInfo: katago.RootInfo{Visits: 8}})
	}
	return katago.Result{ID: query.ID, RootInfo: katago.RootInfo{Visits: 80}}, nil
}

func (a clientFakeAnalyzer) Available() bool { return true }

func (a clientFakeAnalyzer) Status() katago.Status {
	return katago.Status{Available: true}
}

func (a clientFakeAnalyzer) Close() error { return nil }

func TestServeConnectionRegistersAndReturnsAnalysis(t *testing.T) {
	server, connCh := testWorkerServer(t)
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		_ = ServeConnection(ctx, "ws"+server.URL[len("http"):], "secret", staticClientRuntime{
			info:     Info{Name: "worker-1"},
			analyzer: clientBasicAnalyzer{},
		})
	}()

	conn := <-connCh
	defer conn.Close()

	var register Envelope
	if err := conn.ReadJSON(&register); err != nil {
		t.Fatal(err)
	}
	if register.Type != MessageRegister || register.Worker == nil || register.Worker.Name != "worker-1" {
		t.Fatalf("register = %#v", register)
	}
	if err := conn.WriteJSON(Envelope{
		Type:   MessageAnalyze,
		ID:     "job-1",
		Query:  &katago.Query{ID: "main:0"},
		Config: &RuntimeConfig{Model: "b18.bin.gz", MaxVisits: 500},
	}); err != nil {
		t.Fatal(err)
	}
	var result Envelope
	if err := conn.ReadJSON(&result); err != nil {
		t.Fatal(err)
	}
	if result.Type != MessageResult || result.ID != "job-1" || result.Result == nil || result.Result.RootInfo.Visits != 88 {
		t.Fatalf("result = %#v", result)
	}
}

func TestServeConnectionForwardsProgress(t *testing.T) {
	server, connCh := testWorkerServer(t)
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		_ = ServeConnection(ctx, "ws"+server.URL[len("http"):], "secret", staticClientRuntime{
			info:     Info{Name: "worker-1"},
			analyzer: clientFakeAnalyzer{progress: true},
		})
	}()

	conn := <-connCh
	defer conn.Close()
	var register Envelope
	if err := conn.ReadJSON(&register); err != nil {
		t.Fatal(err)
	}
	if err := conn.WriteJSON(Envelope{
		Type:   MessageAnalyze,
		ID:     "job-2",
		Query:  &katago.Query{ID: "main:1"},
		Config: &RuntimeConfig{Model: "b18.bin.gz", MaxVisits: 500},
	}); err != nil {
		t.Fatal(err)
	}
	var progress Envelope
	if err := conn.ReadJSON(&progress); err != nil {
		t.Fatal(err)
	}
	if progress.Result == nil || !progress.Result.IsDuringSearch || progress.Result.RootInfo.Visits != 8 {
		t.Fatalf("progress = %#v", progress)
	}
	var final Envelope
	if err := conn.ReadJSON(&final); err != nil {
		t.Fatal(err)
	}
	if final.Result == nil || final.Result.RootInfo.Visits != 80 {
		t.Fatalf("final = %#v", final)
	}
}

func TestServeConnectionPassesAnalyzeConfigToRuntime(t *testing.T) {
	server, connCh := testWorkerServer(t)
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runtime := &clientRecordingRuntime{
		info:    Info{Name: "worker-1"},
		queries: make(chan katago.Query, 1),
		configs: make(chan RuntimeConfig, 1),
	}
	go func() {
		_ = ServeConnection(ctx, "ws"+server.URL[len("http"):], "secret", runtime)
	}()

	conn := <-connCh
	defer conn.Close()
	var register Envelope
	if err := conn.ReadJSON(&register); err != nil {
		t.Fatal(err)
	}
	if err := conn.WriteJSON(Envelope{
		Type:   MessageAnalyze,
		ID:     "job-3",
		Query:  &katago.Query{ID: "main:2", MaxVisits: 1},
		Config: &RuntimeConfig{Model: "new.bin.gz", MaxVisits: 900},
	}); err != nil {
		t.Fatal(err)
	}
	select {
	case query := <-runtime.queries:
		if query.MaxVisits != 1 {
			t.Fatalf("MaxVisits = %d", query.MaxVisits)
		}
	case <-time.After(time.Second):
		t.Fatal("expected query")
	}
	select {
	case cfg := <-runtime.configs:
		if cfg.Model != "new.bin.gz" || cfg.MaxVisits != 900 {
			t.Fatalf("config = %#v", cfg)
		}
	case <-time.After(time.Second):
		t.Fatal("expected config")
	}
}

func testWorkerServer(t *testing.T) (*httptest.Server, <-chan *websocket.Conn) {
	t.Helper()
	connCh := make(chan *websocket.Conn, 1)
	upgrader := websocket.Upgrader{Subprotocols: []string{Subprotocol}, CheckOrigin: func(*http.Request) bool { return true }}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Sec-Websocket-Protocol"); got == "" {
			t.Error("missing subprotocol header")
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Error(err)
			return
		}
		connCh <- conn
	}))
	return server, connCh
}

func TestServeConnectionFailsOnBadURL(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	err := ServeConnection(ctx, "://bad-url", "secret", staticClientRuntime{
		info:     Info{Name: "worker-1"},
		analyzer: clientBasicAnalyzer{},
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

type staticClientRuntime struct {
	info     Info
	analyzer katago.Analyzer
}

func (r staticClientRuntime) Info() Info { return r.info }

func (r staticClientRuntime) Analyze(ctx context.Context, query katago.Query, cfg RuntimeConfig) (katago.Result, error) {
	return r.analyzer.Analyze(ctx, query)
}

func (r staticClientRuntime) AnalyzeWithProgress(ctx context.Context, query katago.Query, cfg RuntimeConfig, progress func(katago.Result)) (katago.Result, error) {
	if progressAnalyzer, ok := r.analyzer.(katago.ProgressAnalyzer); ok {
		return progressAnalyzer.AnalyzeWithProgress(ctx, query, progress)
	}
	return r.analyzer.Analyze(ctx, query)
}

type clientRecordingRuntime struct {
	info    Info
	queries chan katago.Query
	configs chan RuntimeConfig
}

func (r *clientRecordingRuntime) Info() Info { return r.info }

func (r *clientRecordingRuntime) Analyze(ctx context.Context, query katago.Query, cfg RuntimeConfig) (katago.Result, error) {
	r.queries <- query
	r.configs <- cfg
	return katago.Result{ID: query.ID, RootInfo: katago.RootInfo{Visits: query.MaxVisits}}, nil
}

func (r *clientRecordingRuntime) AnalyzeWithProgress(ctx context.Context, query katago.Query, cfg RuntimeConfig, progress func(katago.Result)) (katago.Result, error) {
	return r.Analyze(ctx, query, cfg)
}
