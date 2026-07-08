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
			t.Errorf("message = %#v", msg)
			return
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

func TestPoolStatusSnapshotCountsWorkersAndLocalFallback(t *testing.T) {
	local := &fakeAnalyzer{err: errors.New("local missing")}
	pool := NewPool(local, log.New(io.Discard, "", 0))
	pool.addWorker(&remoteWorker{
		id:        "worker-2",
		info:      Info{Name: "offline-gpu", Platform: "linux/amd64", Available: false, Error: "katago missing"},
		responses: map[string]chan Envelope{},
	})
	pool.addWorker(&remoteWorker{
		id:        "worker-1",
		info:      Info{Name: "busy-gpu", Platform: "windows/amd64", Available: true},
		busy:      true,
		responses: map[string]chan Envelope{},
	})

	status := pool.StatusSnapshot()

	if status.Connected != 2 || status.Available != 1 || status.Busy != 1 {
		t.Fatalf("counts = %#v", status)
	}
	if status.Local.Available || status.Local.Error != "local missing" {
		t.Fatalf("local = %#v", status.Local)
	}
	if len(status.Workers) != 2 {
		t.Fatalf("workers = %#v", status.Workers)
	}
	if status.Workers[0].ID != "worker-1" || !status.Workers[0].Busy || !status.Workers[0].Available {
		t.Fatalf("first worker = %#v", status.Workers[0])
	}
	if status.Workers[1].ID != "worker-2" || status.Workers[1].Available || status.Workers[1].Error != "katago missing" {
		t.Fatalf("second worker = %#v", status.Workers[1])
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
