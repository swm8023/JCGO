package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gorilla/websocket"
)

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
