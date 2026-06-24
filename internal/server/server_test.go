package server

import (
	"net/http/httptest"
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
