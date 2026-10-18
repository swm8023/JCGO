package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestPrefixedStaticAndAuthenticatedWebSockets(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("APP"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "asset.txt"), []byte("ASSET"), 0600); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(New(Config{AccessToken: "secret", StaticDir: dir}, nil).Handler())
	defer srv.Close()
	resp, err := http.Get(srv.URL + "/jcgo/asset.txt")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if string(body) != "ASSET" {
		t.Errorf("prefixed asset = %q", body)
	}
	for _, path := range []string{"/ws", "/jcgo/ws", "/worker", "/jcgo/worker"} {
		protocol := "jcgo-jsonrpc"
		if strings.HasSuffix(path, "worker") {
			protocol = "jcgo-worker"
		}
		for _, token := range []string{"secret", "wrong"} {
			dialer := websocket.Dialer{Subprotocols: []string{protocol, "token." + token}}
			conn, response, err := dialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+path, nil)
			if token == "secret" {
				if err != nil {
					t.Errorf("%s authenticated handshake: %v", path, err)
				}
			} else if response == nil || response.StatusCode != http.StatusUnauthorized {
				t.Errorf("%s accepted wrong token: %v", path, err)
			}
			if conn != nil {
				conn.Close()
			}
			if response != nil {
				response.Body.Close()
			}
		}
	}
}

func TestWebSocketRejectsMissingToken(t *testing.T) {
	srv := httptest.NewServer(New(Config{AccessToken: "secret"}, nil).Handler())
	defer srv.Close()

	url := "ws" + srv.URL[len("http"):] + "/ws"
	_, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err == nil {
		t.Fatal("Dial succeeded without token")
	}
}

func TestWebSocketAcceptsTokenSubprotocol(t *testing.T) {
	srv := httptest.NewServer(New(Config{AccessToken: "secret"}, nil).Handler())
	defer srv.Close()

	dialer := websocket.Dialer{Subprotocols: []string{"jcgo-jsonrpc", "token.secret"}}
	url := "ws" + srv.URL[len("http"):] + "/ws"
	conn, resp, err := dialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("Dial failed: %v", err)
	}
	defer conn.Close()
	if resp.Header.Get("Sec-Websocket-Protocol") != "jcgo-jsonrpc" {
		t.Fatalf("protocol = %q", resp.Header.Get("Sec-Websocket-Protocol"))
	}
}

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

func TestServerServesStaticFilesWithSPAFallback(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("APP"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "asset.txt"), []byte("ASSET"), 0o644); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(New(Config{AccessToken: "secret", StaticDir: dir}, nil).Handler())
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/asset.txt")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("asset status = %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "ASSET" {
		t.Fatalf("asset body = %q", body)
	}

	resp, err = http.Get(srv.URL + "/missing/path")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("fallback status = %d", resp.StatusCode)
	}
	body, err = io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "APP" {
		t.Fatalf("fallback body = %q", body)
	}
}

func TestServerSetsCacheControlForStaticResponses(t *testing.T) {
	dir := t.TempDir()
	for _, path := range []string{
		"index.html",
		"sw.js",
		"manifest.webmanifest",
		filepath.Join("assets", "index-AbCd1234.js"),
		filepath.Join("icons", "jcgo-192.png"),
	} {
		fullPath := filepath.Join(dir, path)
		if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(fullPath, []byte(path), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	srv := httptest.NewServer(New(Config{AccessToken: "secret", StaticDir: dir}, nil).Handler())
	defer srv.Close()

	tests := []struct {
		name  string
		path  string
		cache string
	}{
		{name: "root entry", path: "/", cache: "no-cache, must-revalidate"},
		{name: "explicit entry", path: "/index.html", cache: "no-cache, must-revalidate"},
		{name: "spa fallback", path: "/events/123", cache: "no-cache, must-revalidate"},
		{name: "service worker", path: "/sw.js", cache: "no-cache, must-revalidate"},
		{name: "manifest", path: "/manifest.webmanifest", cache: "no-cache, must-revalidate"},
		{name: "hashed bundle", path: "/assets/index-AbCd1234.js", cache: "public, max-age=31536000, immutable"},
		{name: "unhashed icon", path: "/icons/jcgo-192.png", cache: "no-cache, must-revalidate"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp, err := http.Get(srv.URL + tt.path)
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			if got := resp.Header.Get("Cache-Control"); got != tt.cache {
				t.Fatalf("Cache-Control = %q, want %q", got, tt.cache)
			}
		})
	}
}
