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

func (a clientBasicAnalyzer) Analyze(ctx context.Context, query katago.Query) (katago.Result, error) {
	return katago.Result{ID: query.ID, RootInfo: katago.RootInfo{Visits: 88}}, nil
}

func (a clientBasicAnalyzer) Available() bool { return true }

func (a clientBasicAnalyzer) Status() katago.Status {
	return katago.Status{Available: true}
}

func (a clientBasicAnalyzer) Close() error { return nil }

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
		_ = ServeConnection(ctx, "ws"+server.URL[len("http"):], "secret", Info{Name: "worker-1", Available: true}, clientBasicAnalyzer{})
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
	err := ServeConnection(ctx, "://bad-url", "secret", Info{Name: "worker-1"}, clientBasicAnalyzer{})
	if err == nil {
		t.Fatal("expected error")
	}
}
