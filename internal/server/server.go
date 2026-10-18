package server

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
)

type Config struct {
	AccessToken string
	StaticDir   string
}

type RPCHandler interface {
	ServeWS(token string, conn *websocket.Conn)
}

type WorkerHandler interface {
	ServeWorkerWS(conn *websocket.Conn)
}

type Server struct {
	cfg           Config
	handler       RPCHandler
	workerHandler WorkerHandler
	mu            sync.Mutex
	connections   map[*websocket.Conn]struct{}
	closing       bool
	wg            sync.WaitGroup
}

const (
	staticRevalidationCacheControl = "no-cache, must-revalidate"
	immutableAssetCacheControl     = "public, max-age=31536000, immutable"
)

func New(cfg Config, handler RPCHandler) *Server {
	return NewWithWorker(cfg, handler, nil)
}

func NewWithWorker(cfg Config, handler RPCHandler, workerHandler WorkerHandler) *Server {
	return &Server{cfg: cfg, handler: handler, workerHandler: workerHandler, connections: make(map[*websocket.Conn]struct{})}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", s.handleWS)
	mux.HandleFunc("/worker", s.handleWorkerWS)
	mux.HandleFunc("/", s.serveStatic)
	root := http.NewServeMux()
	root.Handle("/jcgo/", http.StripPrefix("/jcgo", mux))
	root.Handle("/", mux)
	return root
}

// Close also terminates upgraded connections, which http.Server.Shutdown does not own.
func (s *Server) Close() {
	s.mu.Lock()
	s.closing = true
	for conn := range s.connections {
		_ = conn.Close()
	}
	s.mu.Unlock()
	s.wg.Wait()
}

func (s *Server) track(conn *websocket.Conn) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closing {
		_ = conn.Close()
		return false
	}
	s.connections[conn] = struct{}{}
	s.wg.Add(1)
	return true
}

func (s *Server) untrack(conn *websocket.Conn) {
	s.mu.Lock()
	delete(s.connections, conn)
	s.mu.Unlock()
	s.wg.Done()
}

func (s *Server) serveStatic(w http.ResponseWriter, r *http.Request) {
	if s.cfg.StaticDir == "" {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("JCGO"))
		return
	}
	clean := filepath.Clean(strings.TrimPrefix(r.URL.Path, "/"))
	if !filepath.IsLocal(clean) {
		http.NotFound(w, r)
		return
	}
	if clean == "index.html" || clean == "." {
		s.serveIndex(w, r)
		return
	}
	if clean != "." {
		path := filepath.Join(s.cfg.StaticDir, clean)
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			setStaticCacheControl(w, r.URL.Path)
			http.ServeFile(w, r, path)
			return
		}
	}
	s.serveIndex(w, r)
}

func (s *Server) serveIndex(w http.ResponseWriter, r *http.Request) {
	data, err := os.ReadFile(filepath.Join(s.cfg.StaticDir, "index.html"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	base := "/"
	if strings.HasPrefix(r.RequestURI, "/jcgo/") {
		base = "/jcgo/"
	}
	data = []byte(strings.ReplaceAll(string(data), `<base href="/" data-jcgo-base />`, `<base href="`+base+`" data-jcgo-base />`))
	w.Header().Set("Cache-Control", staticRevalidationCacheControl)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if r.Method != http.MethodHead {
		_, _ = w.Write(data)
	}
}

func setStaticCacheControl(w http.ResponseWriter, requestPath string) {
	cacheControl := staticRevalidationCacheControl
	if strings.HasPrefix(requestPath, "/assets/") {
		cacheControl = immutableAssetCacheControl
	}
	w.Header().Set("Cache-Control", cacheControl)
}

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
	if !s.track(conn) {
		return
	}
	defer s.untrack(conn)
	if s.handler == nil {
		_ = conn.Close()
		return
	}
	s.handler.ServeWS(token, conn)
}

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
	if !s.track(conn) {
		return
	}
	defer s.untrack(conn)
	if s.workerHandler == nil {
		_ = conn.Close()
		return
	}
	s.workerHandler.ServeWorkerWS(conn)
}

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
