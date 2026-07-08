# Remote Analysis Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Windows `jcgo-worker.exe` that connects to JCGO, runs local KataGo remotely, and lets JCGO prefer remote analysis with local fallback.

**Architecture:** Add an `internal/worker` package shared by the JCGO server and worker executable. The server-side worker pool implements `katago.Analyzer` and wraps the existing local analyzer as fallback; the worker executable reads same-directory JSON config, starts local KataGo, connects to `/worker`, registers its capabilities, and answers analysis jobs over WebSocket.

**Tech Stack:** Go, Gorilla WebSocket, existing `katago.Analyzer` and KataGo analysis JSON protocol, PowerShell build script.

---

## File Structure

- Create `internal/worker/protocol.go`: shared WebSocket message envelope, worker info, and message type constants.
- Create `internal/worker/config.go`: worker config shape, example config bytes, config load/create, and input-boundary validation.
- Create `internal/worker/config_test.go`: config template generation and load validation tests.
- Create `internal/worker/pool.go`: server-side worker registry, WebSocket registration loop, remote analyzer, progress forwarding, and local fallback.
- Create `internal/worker/pool_test.go`: remote success, progress, no-worker fallback, worker-error fallback, all-fail error, and registry cleanup tests.
- Modify `internal/server/server.go`: add optional `/worker` WebSocket endpoint using `jcgo-worker` subprotocol and existing token.
- Modify `internal/server/server_test.go`: add worker endpoint token accept/reject tests.
- Modify `internal/app/app.go`: compose local KataGo analyzer with `worker.Pool`, expose pool for server wiring, and keep `EngineStatus`.
- Modify `internal/app/app_test.go`: update expectations for worker pool wrapping unavailable local analyzer.
- Modify `cmd/jcgo/main.go`: pass `application.Workers` into the server constructor.
- Create `internal/worker/client.go`: worker-side WebSocket client that registers and serves analyze jobs using a `katago.Analyzer`.
- Create `internal/worker/client_test.go`: worker client registration and analysis-response tests using an in-process WebSocket server and fake analyzer.
- Create `cmd/jcgo-worker/main.go`: Windows-friendly worker entrypoint that reads config next to the exe, opens `jcgo-worker.log`, starts KataGo, and runs the worker client.
- Create `configs/jcgo-worker.example.json`: checked-in config template copied by the build script.
- Create `scripts/build-worker.ps1`: builds `dist/worker/jcgo-worker.exe` and writes/copies config templates.
- Modify `README.md`: document building and running the worker.

---

### Task 1: Shared Worker Protocol and Config

**Files:**
- Create: `internal/worker/protocol.go`
- Create: `internal/worker/config.go`
- Create: `internal/worker/config_test.go`

- [ ] **Step 1: Write config tests first**

Add `internal/worker/config_test.go`:

```go
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
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `go test ./internal/worker`

Expected: FAIL because package `jcgo/internal/worker` and `LoadOrCreateConfig` do not exist.

- [ ] **Step 3: Add protocol types**

Create `internal/worker/protocol.go`:

```go
package worker

import "jcgo/internal/katago"

const (
	Subprotocol = "jcgo-worker"

	MessageRegister = "register"
	MessageAnalyze  = "analyze"
	MessageResult   = "result"
	MessageError    = "error"
)

type Info struct {
	Name               string `json:"name"`
	Platform           string `json:"platform"`
	KatagoPath         string `json:"katagoPath"`
	ModelPath          string `json:"modelPath"`
	AnalysisConfigPath string `json:"analysisConfigPath"`
	Available          bool   `json:"available"`
	Error              string `json:"error,omitempty"`
}

type Envelope struct {
	Type   string         `json:"type"`
	ID     string         `json:"id,omitempty"`
	Worker *Info          `json:"worker,omitempty"`
	Query  *katago.Query  `json:"query,omitempty"`
	Result *katago.Result `json:"result,omitempty"`
	Error  string         `json:"error,omitempty"`
}
```

- [ ] **Step 4: Add config loading and template generation**

Create `internal/worker/config.go`:

```go
package worker

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
)

type Config struct {
	ServerURL          string `json:"serverUrl"`
	AccessToken        string `json:"accessToken"`
	WorkerName         string `json:"workerName"`
	KatagoPath         string `json:"katagoPath"`
	ModelPath          string `json:"modelPath"`
	AnalysisConfigPath string `json:"analysisConfigPath"`
}

func ExampleConfigJSON() []byte {
	return []byte(`{
  "serverUrl": "ws://127.0.0.1:4380/worker",
  "accessToken": "dev-token",
  "workerName": "gpu-worker-1",
  "katagoPath": "D:\\KataGo\\katago.exe",
  "modelPath": "D:\\KataGo\\models\\model.bin.gz",
  "analysisConfigPath": "D:\\KataGo\\analysis_config.cfg"
}
`)
}

func LoadOrCreateConfig(path string) (Config, bool, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		if err := os.WriteFile(path, ExampleConfigJSON(), 0o644); err != nil {
			return Config{}, false, err
		}
		return Config{}, true, nil
	}
	if err != nil {
		return Config{}, false, err
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Config{}, false, err
	}
	return cfg, false, nil
}

func (c Config) MissingFields() []string {
	fields := []struct {
		name  string
		value string
	}{
		{name: "serverUrl", value: c.ServerURL},
		{name: "accessToken", value: c.AccessToken},
		{name: "workerName", value: c.WorkerName},
		{name: "katagoPath", value: c.KatagoPath},
		{name: "modelPath", value: c.ModelPath},
		{name: "analysisConfigPath", value: c.AnalysisConfigPath},
	}
	missing := make([]string, 0)
	for _, field := range fields {
		if strings.TrimSpace(field.value) == "" {
			missing = append(missing, field.name)
		}
	}
	return missing
}
```

- [ ] **Step 5: Run config tests**

Run: `go test ./internal/worker -run 'TestLoadOrCreateConfig|TestConfigMissingFields'`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add internal/worker/protocol.go internal/worker/config.go internal/worker/config_test.go
git commit -m "feat: add worker protocol config"
```

---

### Task 2: Server-Side Worker Pool Analyzer

**Files:**
- Create: `internal/worker/pool.go`
- Create: `internal/worker/pool_test.go`

- [ ] **Step 1: Write pool tests**

Add `internal/worker/pool_test.go` with tests covering the server-side analyzer behavior:

```go
package worker

import (
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"jcgo/internal/katago"
)

type fakeAnalyzer struct {
	calls   []string
	results []katago.Result
	err     error
}

func (f *fakeAnalyzer) Analyze(ctx context.Context, query katago.Query) (katago.Result, error) {
	f.calls = append(f.calls, query.ID)
	if f.err != nil {
		return katago.Result{}, f.err
	}
	if len(f.results) > 0 {
		return f.results[0], nil
	}
	return katago.Result{ID: query.ID, RootInfo: katago.RootInfo{Visits: 10}}, nil
}

func (f *fakeAnalyzer) Available() bool { return f.err == nil }
func (f *fakeAnalyzer) Status() katago.Status {
	if f.err != nil {
		return katago.Status{Available: false, Error: f.err.Error()}
	}
	return katago.Status{Available: true}
}
func (f *fakeAnalyzer) Close() error { return nil }

func TestPoolFallsBackWhenNoWorkerIsConnected(t *testing.T) {
	local := &fakeAnalyzer{results: []katago.Result{{ID: "main:0", RootInfo: katago.RootInfo{Visits: 99}}}}
	pool := NewPool(local, log.New(io.Discard, "", 0))

	result, err := pool.Analyze(context.Background(), katago.Query{ID: "main:0"})
	if err != nil {
		t.Fatal(err)
	}
	if result.RootInfo.Visits != 99 {
		t.Fatalf("result = %#v", result)
	}
	if len(local.calls) != 1 {
		t.Fatalf("local calls = %v", local.calls)
	}
}

func TestPoolUsesRegisteredWorker(t *testing.T) {
	local := &fakeAnalyzer{}
	pool := NewPool(local, log.New(io.Discard, "", 0))
	serverURL, closeServer := servePool(t, pool)
	defer closeServer()

	done := make(chan struct{})
	go runFakeWorker(t, serverURL, func(conn *websocket.Conn, msg Envelope) {
		if msg.Type != MessageAnalyze || msg.Query == nil || msg.Query.ID != "main:1" {
			t.Fatalf("message = %#v", msg)
		}
		err := conn.WriteJSON(Envelope{
			Type:   MessageResult,
			ID:     msg.ID,
			Result: &katago.Result{ID: msg.Query.ID, RootInfo: katago.RootInfo{Visits: 123}},
		})
		if err != nil {
			t.Error(err)
		}
		close(done)
	})

	waitForWorkers(t, pool, 1)
	result, err := pool.Analyze(context.Background(), katago.Query{ID: "main:1"})
	if err != nil {
		t.Fatal(err)
	}
	if result.RootInfo.Visits != 123 {
		t.Fatalf("result = %#v", result)
	}
	if len(local.calls) != 0 {
		t.Fatalf("local calls = %v", local.calls)
	}
	<-done
}

func TestPoolForwardsWorkerProgress(t *testing.T) {
	pool := NewPool(&fakeAnalyzer{}, log.New(io.Discard, "", 0))
	serverURL, closeServer := servePool(t, pool)
	defer closeServer()

	go runFakeWorker(t, serverURL, func(conn *websocket.Conn, msg Envelope) {
		if err := conn.WriteJSON(Envelope{
			Type:   MessageResult,
			ID:     msg.ID,
			Result: &katago.Result{ID: msg.Query.ID, IsDuringSearch: true, RootInfo: katago.RootInfo{Visits: 7}},
		}); err != nil {
			t.Error(err)
		}
		if err := conn.WriteJSON(Envelope{
			Type:   MessageResult,
			ID:     msg.ID,
			Result: &katago.Result{ID: msg.Query.ID, RootInfo: katago.RootInfo{Visits: 70}},
		}); err != nil {
			t.Error(err)
		}
	})

	waitForWorkers(t, pool, 1)
	var progressVisits int
	engine := any(pool).(katago.ProgressAnalyzer)
	result, err := engine.AnalyzeWithProgress(context.Background(), katago.Query{ID: "main:2"}, func(result katago.Result) {
		progressVisits = result.RootInfo.Visits
	})
	if err != nil {
		t.Fatal(err)
	}
	if progressVisits != 7 || result.RootInfo.Visits != 70 {
		t.Fatalf("progress = %d result = %#v", progressVisits, result)
	}
}

func TestPoolFallsBackWhenWorkerReturnsError(t *testing.T) {
	local := &fakeAnalyzer{results: []katago.Result{{ID: "main:3", RootInfo: katago.RootInfo{Visits: 44}}}}
	pool := NewPool(local, log.New(io.Discard, "", 0))
	serverURL, closeServer := servePool(t, pool)
	defer closeServer()

	go runFakeWorker(t, serverURL, func(conn *websocket.Conn, msg Envelope) {
		if err := conn.WriteJSON(Envelope{Type: MessageError, ID: msg.ID, Error: "worker failed"}); err != nil {
			t.Error(err)
		}
	})

	waitForWorkers(t, pool, 1)
	result, err := pool.Analyze(context.Background(), katago.Query{ID: "main:3"})
	if err != nil {
		t.Fatal(err)
	}
	if result.RootInfo.Visits != 44 || len(local.calls) != 1 {
		t.Fatalf("result = %#v local calls = %v", result, local.calls)
	}
}

func TestPoolReturnsErrorWhenWorkerAndFallbackFail(t *testing.T) {
	local := &fakeAnalyzer{err: errors.New("local missing")}
	pool := NewPool(local, log.New(io.Discard, "", 0))

	_, err := pool.Analyze(context.Background(), katago.Query{ID: "main:4"})
	if err == nil || err.Error() != "local missing" {
		t.Fatalf("err = %v", err)
	}
}

func servePool(t *testing.T, pool *Pool) (string, func()) {
	t.Helper()
	upgrader := websocket.Upgrader{Subprotocols: []string{Subprotocol}, CheckOrigin: func(*http.Request) bool { return true }}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Error(err)
			return
		}
		pool.ServeWS(conn)
	}))
	return "ws" + srv.URL[len("http"):] + "/", srv.Close
}

func runFakeWorker(t *testing.T, url string, handle func(*websocket.Conn, Envelope)) {
	t.Helper()
	dialer := websocket.Dialer{Subprotocols: []string{Subprotocol}}
	conn, _, err := dialer.Dial(url, nil)
	if err != nil {
		t.Error(err)
		return
	}
	defer conn.Close()
	if err := conn.WriteJSON(Envelope{
		Type: MessageRegister,
		Worker: &Info{
			Name:               "test-worker",
			Platform:           "windows/amd64",
			KatagoPath:         "katago.exe",
			ModelPath:          "model.bin.gz",
			AnalysisConfigPath: "analysis_config.cfg",
			Available:          true,
		},
	}); err != nil {
		t.Error(err)
		return
	}
	var msg Envelope
	if err := conn.ReadJSON(&msg); err != nil {
		t.Error(err)
		return
	}
	handle(conn, msg)
}

func waitForWorkers(t *testing.T, pool *Pool, want int) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if pool.WorkerCount() == want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("workers = %d, want %d", pool.WorkerCount(), want)
}
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `go test ./internal/worker -run 'TestPool'`

Expected: FAIL because `Pool`, `NewPool`, `ServeWS`, and `WorkerCount` do not exist.

- [ ] **Step 3: Implement the worker pool**

Create `internal/worker/pool.go` with this structure:

```go
package worker

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"
	"sync/atomic"

	"github.com/gorilla/websocket"

	"jcgo/internal/katago"
)

type Pool struct {
	fallback katago.Analyzer
	logger   *log.Logger

	seq uint64
	mu  sync.Mutex
	ws  map[string]*remoteWorker
}

type remoteWorker struct {
	id        string
	info      Info
	conn      *websocket.Conn
	writeMu   sync.Mutex
	busy      bool
	closed    bool
	responses map[string]chan Envelope
}

func NewPool(fallback katago.Analyzer, logger *log.Logger) *Pool {
	if logger == nil {
		logger = log.Default()
	}
	return &Pool{
		fallback: fallback,
		logger:   logger,
		ws:       map[string]*remoteWorker{},
	}
}

func (p *Pool) Analyze(ctx context.Context, query katago.Query) (katago.Result, error) {
	return p.AnalyzeWithProgress(ctx, query, nil)
}

func (p *Pool) AnalyzeWithProgress(ctx context.Context, query katago.Query, progress func(katago.Result)) (katago.Result, error) {
	worker := p.pickWorker()
	if worker == nil {
		p.logger.Printf("worker pool: no idle remote worker, using local analyzer for query %s", query.ID)
		return p.analyzeFallback(ctx, query, progress)
	}

	result, err := p.analyzeRemote(ctx, worker, query, progress)
	p.releaseWorker(worker)
	if err == nil {
		return result, nil
	}
	p.logger.Printf("worker pool: remote worker %s failed query %s: %v; using local analyzer", worker.info.Name, query.ID, err)
	return p.analyzeFallback(ctx, query, progress)
}

func (p *Pool) Available() bool {
	p.mu.Lock()
	for _, worker := range p.ws {
		if !worker.closed && worker.info.Available {
			p.mu.Unlock()
			return true
		}
	}
	p.mu.Unlock()
	return p.fallback.Available()
}

func (p *Pool) Status() katago.Status {
	if p.Available() {
		return katago.Status{Available: true}
	}
	return p.fallback.Status()
}

func (p *Pool) Close() error {
	p.mu.Lock()
	workers := make([]*remoteWorker, 0, len(p.ws))
	for _, worker := range p.ws {
		workers = append(workers, worker)
	}
	p.mu.Unlock()
	for _, worker := range workers {
		_ = worker.conn.Close()
	}
	return p.fallback.Close()
}

func (p *Pool) ServeWS(conn *websocket.Conn) {
	defer conn.Close()

	var register Envelope
	if err := conn.ReadJSON(&register); err != nil {
		p.logger.Printf("worker pool: failed to read register message: %v", err)
		return
	}
	if register.Type != MessageRegister || register.Worker == nil {
		p.logger.Printf("worker pool: rejected connection without register message")
		return
	}

	id := fmt.Sprintf("worker-%d", atomic.AddUint64(&p.seq, 1))
	worker := &remoteWorker{
		id:        id,
		info:      *register.Worker,
		conn:      conn,
		responses: map[string]chan Envelope{},
	}
	p.addWorker(worker)
	defer p.removeWorker(id)

	for {
		var msg Envelope
		if err := conn.ReadJSON(&msg); err != nil {
			p.logger.Printf("worker pool: worker %s disconnected: %v", worker.info.Name, err)
			return
		}
		p.deliver(worker, msg)
	}
}

func (p *Pool) ServeWorkerWS(conn *websocket.Conn) {
	p.ServeWS(conn)
}

func (p *Pool) WorkerCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.ws)
}

func (p *Pool) addWorker(worker *remoteWorker) {
	p.mu.Lock()
	p.ws[worker.id] = worker
	p.mu.Unlock()
	p.logger.Printf("worker pool: registered %s platform=%s katago=%s model=%s config=%s available=%t error=%s",
		worker.info.Name, worker.info.Platform, worker.info.KatagoPath, worker.info.ModelPath, worker.info.AnalysisConfigPath, worker.info.Available, worker.info.Error)
}

func (p *Pool) removeWorker(id string) {
	p.mu.Lock()
	worker, ok := p.ws[id]
	if ok {
		worker.closed = true
		for _, ch := range worker.responses {
			close(ch)
		}
		delete(p.ws, id)
	}
	p.mu.Unlock()
	if ok {
		p.logger.Printf("worker pool: removed %s", worker.info.Name)
	}
}

func (p *Pool) pickWorker() *remoteWorker {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, worker := range p.ws {
		if !worker.closed && !worker.busy && worker.info.Available {
			worker.busy = true
			return worker
		}
	}
	return nil
}

func (p *Pool) releaseWorker(worker *remoteWorker) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if current, ok := p.ws[worker.id]; ok {
		current.busy = false
	}
}

func (p *Pool) analyzeRemote(ctx context.Context, worker *remoteWorker, query katago.Query, progress func(katago.Result)) (katago.Result, error) {
	id := fmt.Sprintf("job-%d", atomic.AddUint64(&p.seq, 1))
	ch := make(chan Envelope, 8)

	p.mu.Lock()
	if worker.closed {
		p.mu.Unlock()
		return katago.Result{}, errors.New("worker disconnected")
	}
	worker.responses[id] = ch
	p.mu.Unlock()
	defer func() {
		p.mu.Lock()
		delete(worker.responses, id)
		p.mu.Unlock()
	}()

	worker.writeMu.Lock()
	err := worker.conn.WriteJSON(Envelope{Type: MessageAnalyze, ID: id, Query: &query})
	worker.writeMu.Unlock()
	if err != nil {
		return katago.Result{}, err
	}

	for {
		select {
		case <-ctx.Done():
			return katago.Result{}, ctx.Err()
		case msg, ok := <-ch:
			if !ok {
				return katago.Result{}, errors.New("worker disconnected")
			}
			if msg.Type == MessageError {
				if msg.Error == "" {
					msg.Error = "worker returned error"
				}
				return katago.Result{}, errors.New(msg.Error)
			}
			if msg.Type != MessageResult || msg.Result == nil {
				return katago.Result{}, fmt.Errorf("unexpected worker message %q", msg.Type)
			}
			if msg.Result.IsDuringSearch {
				if progress != nil {
					progress(*msg.Result)
				}
				continue
			}
			return *msg.Result, nil
		}
	}
}

func (p *Pool) deliver(worker *remoteWorker, msg Envelope) {
	p.mu.Lock()
	ch := worker.responses[msg.ID]
	p.mu.Unlock()
	if ch == nil {
		p.logger.Printf("worker pool: ignoring response with unknown id %s from %s", msg.ID, worker.info.Name)
		return
	}
	ch <- msg
}

func (p *Pool) analyzeFallback(ctx context.Context, query katago.Query, progress func(katago.Result)) (katago.Result, error) {
	if engine, ok := p.fallback.(katago.ProgressAnalyzer); ok {
		return engine.AnalyzeWithProgress(ctx, query, progress)
	}
	return p.fallback.Analyze(ctx, query)
}
```

- [ ] **Step 4: Run worker pool tests**

Run: `go test ./internal/worker -run 'TestPool'`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add internal/worker/pool.go internal/worker/pool_test.go
git commit -m "feat: add remote worker pool"
```

---

### Task 3: JCGO Worker WebSocket Endpoint

**Files:**
- Modify: `internal/server/server.go`
- Modify: `internal/server/server_test.go`

- [ ] **Step 1: Add endpoint tests**

Append to `internal/server/server_test.go`:

```go
type recordingWorkerHandler struct {
	served chan struct{}
}

func (h *recordingWorkerHandler) ServeWorkerWS(conn *websocket.Conn) {
	close(h.served)
	_ = conn.Close()
}

func TestWorkerWebSocketRejectsMissingToken(t *testing.T) {
	workerHandler := &recordingWorkerHandler{served: make(chan struct{})}
	srv := httptest.NewServer(NewWithWorker(Config{AccessToken: "secret"}, nil, workerHandler).Handler())
	defer srv.Close()

	url := "ws" + srv.URL[len("http"):] + "/worker"
	_, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err == nil {
		t.Fatal("Dial succeeded without token")
	}
}

func TestWorkerWebSocketAcceptsTokenSubprotocol(t *testing.T) {
	workerHandler := &recordingWorkerHandler{served: make(chan struct{})}
	srv := httptest.NewServer(NewWithWorker(Config{AccessToken: "secret"}, nil, workerHandler).Handler())
	defer srv.Close()

	dialer := websocket.Dialer{Subprotocols: []string{"jcgo-worker", "token.secret"}}
	url := "ws" + srv.URL[len("http"):] + "/worker"
	conn, resp, err := dialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("Dial failed: %v", err)
	}
	defer conn.Close()
	if resp.Header.Get("Sec-Websocket-Protocol") != "jcgo-worker" {
		t.Fatalf("protocol = %q", resp.Header.Get("Sec-Websocket-Protocol"))
	}
	select {
	case <-workerHandler.served:
	case <-time.After(time.Second):
		t.Fatal("worker handler was not called")
	}
}
```

Also add `time` to the imports in `internal/server/server_test.go`.

- [ ] **Step 2: Run server tests and verify they fail**

Run: `go test ./internal/server`

Expected: FAIL because `NewWithWorker` and `ServeWorkerWS` wiring do not exist.

- [ ] **Step 3: Implement `/worker` endpoint**

Modify `internal/server/server.go`:

```go
type WorkerHandler interface {
	ServeWorkerWS(conn *websocket.Conn)
}

type Server struct {
	cfg           Config
	handler       RPCHandler
	workerHandler WorkerHandler
}

func New(cfg Config, handler RPCHandler) *Server {
	return NewWithWorker(cfg, handler, nil)
}

func NewWithWorker(cfg Config, handler RPCHandler, workerHandler WorkerHandler) *Server {
	return &Server{cfg: cfg, handler: handler, workerHandler: workerHandler}
}
```

Update `Handler()`:

```go
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", s.handleWS)
	mux.HandleFunc("/worker", s.handleWorkerWS)
	mux.HandleFunc("/", s.serveStatic)
	return mux
}
```

Update token parsing and the existing app websocket call:

```go
func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	token, ok := tokenFromSubprotocols(r.Header.Values("Sec-Websocket-Protocol"), "jcgo-jsonrpc", s.cfg.AccessToken)
	if !ok {
		http.Error(w, "websocket token rejected", http.StatusUnauthorized)
		return
	}
	upgrader := websocket.Upgrader{
		Subprotocols: []string{"jcgo-jsonrpc"},
		CheckOrigin:  func(*http.Request) bool { return true },
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	if s.handler == nil {
		_ = conn.Close()
		return
	}
	s.handler.ServeWS(token, conn)
}
```

Add worker handler:

```go
func (s *Server) handleWorkerWS(w http.ResponseWriter, r *http.Request) {
	_, ok := tokenFromSubprotocols(r.Header.Values("Sec-Websocket-Protocol"), "jcgo-worker", s.cfg.AccessToken)
	if !ok {
		http.Error(w, "worker websocket token rejected", http.StatusUnauthorized)
		return
	}
	upgrader := websocket.Upgrader{
		Subprotocols: []string{"jcgo-worker"},
		CheckOrigin:  func(*http.Request) bool { return true },
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	if s.workerHandler == nil {
		_ = conn.Close()
		return
	}
	s.workerHandler.ServeWorkerWS(conn)
}
```

Replace token helper:

```go
func tokenFromSubprotocols(values []string, protocol string, expectedToken string) (string, bool) {
	wantToken := "token." + expectedToken
	foundProtocol := false
	foundToken := false
	for _, value := range values {
		for _, part := range strings.Split(value, ",") {
			item := strings.TrimSpace(part)
			if item == protocol {
				foundProtocol = true
			}
			if item == wantToken {
				foundToken = true
			}
		}
	}
	if !foundProtocol || !foundToken {
		return "", false
	}
	return expectedToken, true
}
```

- [ ] **Step 4: Run server tests**

Run: `go test ./internal/server`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add internal/server/server.go internal/server/server_test.go
git commit -m "feat: expose worker websocket endpoint"
```

---

### Task 4: App Integration and Local Fallback Composition

**Files:**
- Modify: `internal/app/app.go`
- Modify: `internal/app/app_test.go`
- Modify: `cmd/jcgo/main.go`

- [ ] **Step 1: Write app integration expectation**

Modify `internal/app/app_test.go` to also assert the worker pool exists:

```go
if app.Workers == nil {
	t.Fatal("workers should be configured")
}
```

Keep the existing unavailable-engine assertion; with no local KataGo paths and no workers, `EngineStatus().Available` must remain false.

- [ ] **Step 2: Run app tests and verify they fail**

Run: `go test ./internal/app -run TestNewAppStartsWithUnavailableEngineWhenPathsMissing`

Expected: FAIL because `App.Workers` does not exist.

- [ ] **Step 3: Compose local analyzer with worker pool**

Modify imports in `internal/app/app.go`:

```go
import (
	"context"
	"errors"
	"log"
	"path/filepath"

	"jcgo/internal/config"
	"jcgo/internal/katago"
	"jcgo/internal/store"
	"jcgo/internal/worker"
)
```

Update `App`:

```go
type App struct {
	Repo       *store.Repository
	Files      store.FileStore
	Workspaces *WorkspaceStore
	Engine     katago.Analyzer
	Workers    *worker.Pool
	Scheduler  *Scheduler
	RPC        *Handler
}
```

Update `New` after local engine startup:

```go
	localEngine, err := startEngine(ctx, cfg)
	if err != nil {
		localEngine = katago.NewUnavailable(err.Error())
	}
	workers := worker.NewPool(localEngine, log.Default())
	engine := katago.Analyzer(workers)
	workspaces := NewWorkspaceStore()
	scheduler := NewScheduler(engine, cfg.MaxVisits)
```

Update the returned `App`:

```go
	return &App{
		Repo:       repo,
		Files:      files,
		Workspaces: workspaces,
		Engine:     engine,
		Workers:    workers,
		Scheduler:  scheduler,
		RPC:        handler,
	}, nil
```

- [ ] **Step 4: Wire server main to the worker handler**

Modify `cmd/jcgo/main.go`:

```go
srv := server.NewWithWorker(server.Config{AccessToken: cfg.AccessToken, StaticDir: "web/dist"}, application.RPC, application.Workers)
```

- [ ] **Step 5: Run app and server packages**

Run: `go test ./internal/app ./internal/server`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add internal/app/app.go internal/app/app_test.go cmd/jcgo/main.go
git commit -m "feat: route analysis through worker pool"
```

---

### Task 5: Worker Client Runtime

**Files:**
- Create: `internal/worker/client.go`
- Create: `internal/worker/client_test.go`

- [ ] **Step 1: Write worker client tests**

Create `internal/worker/client_test.go`:

```go
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
		_ = ServeConnection(ctx, "ws"+server.URL[len("http"):], "secret", Info{Name: "worker-1", Available: true}, clientFakeAnalyzer{})
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
	if err := conn.WriteJSON(Envelope{Type: MessageAnalyze, ID: "job-1", Query: &katago.Query{ID: "main:0"}}); err != nil {
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
		_ = ServeConnection(ctx, "ws"+server.URL[len("http"):], "secret", Info{Name: "worker-1", Available: true}, clientFakeAnalyzer{progress: true})
	}()

	conn := <-connCh
	defer conn.Close()
	var register Envelope
	if err := conn.ReadJSON(&register); err != nil {
		t.Fatal(err)
	}
	if err := conn.WriteJSON(Envelope{Type: MessageAnalyze, ID: "job-2", Query: &katago.Query{ID: "main:1"}}); err != nil {
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
	err := ServeConnection(ctx, "://bad-url", "secret", Info{Name: "worker-1"}, clientFakeAnalyzer{})
	if err == nil {
		t.Fatal("expected error")
	}
}
```

- [ ] **Step 2: Run worker client tests and verify they fail**

Run: `go test ./internal/worker -run 'TestServeConnection'`

Expected: FAIL because `ServeConnection` does not exist.

- [ ] **Step 3: Implement worker client connection serving**

Create `internal/worker/client.go`:

```go
package worker

import (
	"context"
	"errors"
	"fmt"

	"github.com/gorilla/websocket"

	"jcgo/internal/katago"
)

func ServeConnection(ctx context.Context, serverURL string, accessToken string, info Info, engine katago.Analyzer) error {
	dialer := websocket.Dialer{Subprotocols: []string{Subprotocol, "token." + accessToken}}
	conn, _, err := dialer.DialContext(ctx, serverURL, nil)
	if err != nil {
		return err
	}
	defer conn.Close()

	if err := conn.WriteJSON(Envelope{Type: MessageRegister, Worker: &info}); err != nil {
		return err
	}

	for {
		var msg Envelope
		if err := conn.ReadJSON(&msg); err != nil {
			return err
		}
		if msg.Type != MessageAnalyze || msg.Query == nil {
			_ = conn.WriteJSON(Envelope{Type: MessageError, ID: msg.ID, Error: fmt.Sprintf("unexpected message %q", msg.Type)})
			continue
		}
		if err := analyzeAndReply(ctx, conn, msg.ID, *msg.Query, engine); err != nil {
			return err
		}
	}
}

func analyzeAndReply(ctx context.Context, conn *websocket.Conn, id string, query katago.Query, engine katago.Analyzer) error {
	writeResult := func(result katago.Result) {
		_ = conn.WriteJSON(Envelope{Type: MessageResult, ID: id, Result: &result})
	}

	var (
		result katago.Result
		err    error
	)
	if progressEngine, ok := engine.(katago.ProgressAnalyzer); ok {
		result, err = progressEngine.AnalyzeWithProgress(ctx, query, writeResult)
	} else {
		result, err = engine.Analyze(ctx, query)
	}
	if err != nil {
		if writeErr := conn.WriteJSON(Envelope{Type: MessageError, ID: id, Error: err.Error()}); writeErr != nil {
			return errors.Join(err, writeErr)
		}
		return nil
	}
	return conn.WriteJSON(Envelope{Type: MessageResult, ID: id, Result: &result})
}
```

- [ ] **Step 4: Run worker client tests**

Run: `go test ./internal/worker -run 'TestServeConnection'`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add internal/worker/client.go internal/worker/client_test.go
git commit -m "feat: add worker websocket client"
```

---

### Task 6: Worker Executable

**Files:**
- Create: `cmd/jcgo-worker/main.go`

- [ ] **Step 1: Add worker command entrypoint**

Create `cmd/jcgo-worker/main.go`:

```go
package main

import (
	"context"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"jcgo/internal/katago"
	"jcgo/internal/worker"
)

func main() {
	dir := executableDir()
	logFile, err := os.OpenFile(filepath.Join(dir, "jcgo-worker.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		log.Fatal(err)
	}
	defer logFile.Close()
	logger := log.New(io.MultiWriter(os.Stdout, logFile), "", log.LstdFlags)

	cfgPath := filepath.Join(dir, "jcgo-worker.json")
	cfg, created, err := worker.LoadOrCreateConfig(cfgPath)
	if err != nil {
		logger.Fatalf("failed to load config: %v", err)
	}
	if created {
		logger.Printf("created config template at %s; edit it and restart jcgo-worker.exe", cfgPath)
		return
	}
	if missing := cfg.MissingFields(); len(missing) > 0 {
		logger.Printf("config %s is missing required fields: %s", cfgPath, strings.Join(missing, ", "))
		return
	}

	ctx := context.Background()
	engine, engineErr := katago.StartLocal(ctx, cfg.KatagoPath, cfg.ModelPath, cfg.AnalysisConfigPath)
	available := engineErr == nil
	errorMessage := ""
	if engineErr != nil {
		errorMessage = engineErr.Error()
		engine = katago.NewUnavailable(errorMessage)
		logger.Printf("katago unavailable: %v", engineErr)
	} else {
		defer engine.Close()
		logger.Printf("katago started: path=%s model=%s config=%s", cfg.KatagoPath, cfg.ModelPath, cfg.AnalysisConfigPath)
	}

	info := worker.Info{
		Name:               cfg.WorkerName,
		Platform:           runtime.GOOS + "/" + runtime.GOARCH,
		KatagoPath:         cfg.KatagoPath,
		ModelPath:          cfg.ModelPath,
		AnalysisConfigPath: cfg.AnalysisConfigPath,
		Available:          available,
		Error:              errorMessage,
	}

	for {
		logger.Printf("connecting to %s as %s", cfg.ServerURL, cfg.WorkerName)
		err := worker.ServeConnection(ctx, cfg.ServerURL, cfg.AccessToken, info, engine)
		logger.Printf("connection ended: %v", err)
		time.Sleep(5 * time.Second)
	}
}

func executableDir() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	return filepath.Dir(exe)
}
```

- [ ] **Step 2: Build the worker command**

Run: `go build ./cmd/jcgo-worker`

Expected: PASS and produce a local command build.

- [ ] **Step 3: Commit**

```powershell
git add cmd/jcgo-worker/main.go
git commit -m "feat: add worker executable"
```

---

### Task 7: Build Script and Config Template

**Files:**
- Create: `configs/jcgo-worker.example.json`
- Create: `scripts/build-worker.ps1`
- Modify: `README.md`

- [ ] **Step 1: Add checked-in worker config template**

Create `configs/jcgo-worker.example.json`:

```json
{
  "serverUrl": "ws://127.0.0.1:4380/worker",
  "accessToken": "dev-token",
  "workerName": "gpu-worker-1",
  "katagoPath": "D:\\KataGo\\katago.exe",
  "modelPath": "D:\\KataGo\\models\\model.bin.gz",
  "analysisConfigPath": "D:\\KataGo\\analysis_config.cfg"
}
```

- [ ] **Step 2: Add PowerShell build script**

Create `scripts/build-worker.ps1`:

```powershell
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $repoRoot 'dist\worker'
$exePath = Join-Path $outDir 'jcgo-worker.exe'
$exampleSource = Join-Path $repoRoot 'configs\jcgo-worker.example.json'
$exampleDest = Join-Path $outDir 'jcgo-worker.example.json'
$configDest = Join-Path $outDir 'jcgo-worker.json'

New-Item -ItemType Directory -Force $outDir | Out-Null

Push-Location $repoRoot
try {
    go build -o $exePath .\cmd\jcgo-worker
}
finally {
    Pop-Location
}

Copy-Item -Force $exampleSource $exampleDest
if (-not (Test-Path $configDest)) {
    Copy-Item $exampleSource $configDest
}

Write-Host "Built $exePath"
Write-Host "Edit $configDest before running jcgo-worker.exe"
```

- [ ] **Step 3: Document worker build and run**

Append to `README.md` after the existing server run section:

```markdown
## Remote Worker

Build a Windows worker package:

```powershell
.\scripts\build-worker.ps1
```

The script writes `dist\worker\jcgo-worker.exe`, `dist\worker\jcgo-worker.example.json`, and `dist\worker\jcgo-worker.json` when the editable config does not already exist.

Edit `dist\worker\jcgo-worker.json` on the worker machine, then double-click `jcgo-worker.exe`. The worker writes `jcgo-worker.log` next to the executable and connects to the JCGO `/worker` WebSocket endpoint with the existing `JCGO_ACCESS_TOKEN`.
```

- [ ] **Step 4: Run build script**

Run: `.\scripts\build-worker.ps1`

Expected: PASS, and `dist\worker\jcgo-worker.exe`, `dist\worker\jcgo-worker.example.json`, and `dist\worker\jcgo-worker.json` exist.

- [ ] **Step 5: Commit**

```powershell
git add configs/jcgo-worker.example.json scripts/build-worker.ps1 README.md
git commit -m "chore: add worker build package"
```

---

### Task 8: End-to-End Verification and Cleanup

**Files:**
- Modify only if verification exposes compile or test issues in files touched above.

- [ ] **Step 1: Run backend tests**

Run: `go test ./...`

Expected: PASS.

- [ ] **Step 2: Verify worker package exists**

Run: `Test-Path dist\worker\jcgo-worker.exe; Test-Path dist\worker\jcgo-worker.json`

Expected: both commands print `True`.

- [ ] **Step 3: Manually smoke-test worker config creation**

Run:

```powershell
$tmp = Join-Path $env:TEMP ('jcgo-worker-smoke-' + [guid]::NewGuid())
New-Item -ItemType Directory -Force $tmp | Out-Null
Copy-Item dist\worker\jcgo-worker.exe $tmp
Push-Location $tmp
try {
    Start-Process -FilePath .\jcgo-worker.exe -Wait
    Test-Path .\jcgo-worker.json
    Test-Path .\jcgo-worker.log
}
finally {
    Pop-Location
}
```

Expected: both `Test-Path` commands print `True`, and the log says the config template was created and must be edited.

- [ ] **Step 4: Inspect git diff**

Run: `git diff --stat`

Expected: only worker, server, app, command, script, config template, README, and tests changed.

- [ ] **Step 5: Final commit if verification required fixes**

If Step 1, Step 2, or Step 3 required edits, commit those edits:

```powershell
git add -A
git commit -m "fix: stabilize remote worker verification"
```

If no fixes were needed after Task 7, do not create an empty commit.

---

## Spec Coverage Review

- Worker exe, same-directory config, template generation, and logging are covered by Tasks 1, 6, and 7.
- Worker active connection, access-token auth, registration, and config reporting are covered by Tasks 3, 5, and 6.
- Multiple worker connections, idle selection, serial task dispatch, progress forwarding, and registry cleanup are covered by Task 2.
- Remote-first and local fallback behavior is covered by Tasks 2 and 4.
- No frontend worker UI is preserved by leaving `web/` untouched.
- Build automation is covered by Task 7.
- Verification is covered by Task 8.
