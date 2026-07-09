package worker

import (
	"context"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"jcgo/internal/katago"
)

func TestPoolReturnsErrorWhenNoWorkerIsConnected(t *testing.T) {
	pool := NewPool(log.New(io.Discard, "", 0))

	_, err := pool.Analyze(context.Background(), katago.Query{ID: "main:0"})
	if err == nil || !strings.Contains(err.Error(), "no available worker") {
		t.Fatalf("err = %v", err)
	}
	if pool.Available() {
		t.Fatal("pool should be unavailable without workers")
	}
	status := pool.Status()
	if status.Available || !strings.Contains(status.Error, "no available worker") {
		t.Fatalf("status = %#v", status)
	}
}

func TestPoolUsesRegisteredWorker(t *testing.T) {
	pool := NewPool(log.New(io.Discard, "", 0))
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
	<-done
}

func TestPoolForwardsWorkerProgress(t *testing.T) {
	pool := NewPool(log.New(io.Discard, "", 0))
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

func TestPoolReturnsWorkerErrorWithoutFallback(t *testing.T) {
	pool := NewPool(log.New(io.Discard, "", 0))
	serverURL, closeServer := servePool(t, pool)
	defer closeServer()

	go runFakeWorker(t, serverURL, func(conn *websocket.Conn, msg Envelope) {
		if err := conn.WriteJSON(Envelope{Type: MessageError, ID: msg.ID, Error: "worker failed"}); err != nil {
			t.Error(err)
		}
	})

	waitForWorkers(t, pool, 1)
	_, err := pool.Analyze(context.Background(), katago.Query{ID: "main:3"})
	if err == nil || err.Error() != "worker failed" {
		t.Fatalf("err = %v", err)
	}
}

func TestPoolStatusSnapshotCountsWorkers(t *testing.T) {
	pool := NewPool(log.New(io.Discard, "", 0))
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
