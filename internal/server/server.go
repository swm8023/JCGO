package server

import (
	"net/http"
	"os"
	"path/filepath"
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
	mux.HandleFunc("/", s.serveStatic)
	return mux
}

func (s *Server) serveStatic(w http.ResponseWriter, r *http.Request) {
	if s.cfg.StaticDir == "" {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("JCGO"))
		return
	}
	clean := filepath.Clean(strings.TrimPrefix(r.URL.Path, "/"))
	if clean != "." {
		path := filepath.Join(s.cfg.StaticDir, clean)
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			http.ServeFile(w, r, path)
			return
		}
	}
	http.ServeFile(w, r, filepath.Join(s.cfg.StaticDir, "index.html"))
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
