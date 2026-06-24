package server

import (
	"net/http"
	"strings"

	"github.com/gorilla/websocket"
)

type Config struct {
	AccessToken string
	StaticDir   string
}

type RPCHandler interface {
	ServeWS(token string, conn *websocket.Conn)
}

type Server struct {
	cfg     Config
	handler RPCHandler
}

func New(cfg Config, handler RPCHandler) *Server {
	return &Server{cfg: cfg, handler: handler}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", s.handleWS)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("JCGO"))
	})
	return mux
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	token, ok := tokenFromSubprotocols(r.Header.Values("Sec-Websocket-Protocol"), s.cfg.AccessToken)
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

func tokenFromSubprotocols(values []string, expectedToken string) (string, bool) {
	wantToken := "token." + expectedToken
	foundRPC := false
	foundToken := false
	for _, value := range values {
		for _, part := range strings.Split(value, ",") {
			item := strings.TrimSpace(part)
			if item == "jcgo-jsonrpc" {
				foundRPC = true
			}
			if item == wantToken {
				foundToken = true
			}
		}
	}
	if !foundRPC || !foundToken {
		return "", false
	}
	return expectedToken, true
}
