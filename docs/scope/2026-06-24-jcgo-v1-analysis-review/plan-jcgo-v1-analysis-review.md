# JCGO v1 Analysis Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the confirmed JCGO v1 remote single-token Go/React KataGo analysis review loop from SGF import through live analysis, board review, variations, charts, and responsive PWA shell.

**Architecture:** A Go server owns SGF parsing, game rules, token-scoped workspaces, SQLite/file persistence, JSON-RPC over WebSocket, and one long-running KataGo analysis process. A React + TypeScript + Vite PWA renders server snapshots, uploads SGF text over WebSocket, and provides a KaTrain-inspired board, PV, analysis panel, charts, and game list without becoming the authoritative game engine.

**Tech Stack:** Go 1.23+, `net/http`, Gorilla WebSocket, `modernc.org/sqlite`, React, TypeScript, Vite, ECharts, Vitest, Testing Library, Playwright, KataGo Analysis Engine JSON protocol.

---

## Reference Inputs

- Product spec: `docs/scope/2026-06-24-jcgo-v1-analysis-review/spec-jcgo-v1-analysis-review.md`
- KaTrain feature inventory: `docs/research/katrain-feature-inventory.md`
- Local KaTrain reference source:
  - `D:\Code\katrain\katrain\core\sgf_parser.py`
  - `D:\Code\katrain\katrain\core\game.py`
  - `D:\Code\katrain\katrain\core\game_node.py`
  - `D:\Code\katrain\katrain\core\engine.py`
  - `D:\Code\katrain\katrain\gui\badukpan.py`
  - `D:\Code\katrain\katrain\config.json`

## Planned File Structure

Create a small number of backend packages. In Go, package boundaries should be stable dependency boundaries, not a folder taxonomy. v1 should start with fewer packages and multiple focused files inside each package; split later only after the seams prove stable.

- `cmd/jcgo/main.go` - process entrypoint, config load, service startup, graceful shutdown.
- `internal/config/config.go` - environment/config-file loader and validated runtime config.
- `internal/game/types.go` - colors, moves, stones, snapshots, analysis values.
- `internal/game/sgf.go` - v1 SGF parser, import validation, mainline extraction.
- `internal/game/board.go` - 19x19 board state, captures, ko, pass, initial stones.
- `internal/game/game.go` - mainline nodes, snapshots, navigation, variation mutations.
- `internal/game/analysis.go` - point loss, candidate ordering, KaTrain thresholds, chart/bad-move helpers.
- `internal/app/workspace.go` - token-scoped in-memory games, variations, analysis cache, selected state.
- `internal/app/scheduler.go` - single global analysis queue, start/stop/restart, node-level notifications.
- `internal/app/handlers.go` - JSON-RPC method dispatch for games, navigation, variation, analysis, workspace.
- `internal/katago/query.go` - KataGo query/result structs.
- `internal/katago/engine.go` - local KataGo process lifecycle and stdin/stdout JSON lines.
- `internal/store/repository.go` - SQLite schema and game metadata CRUD.
- `internal/store/files.go` - SGF file path generation, safe writes, safe deletes.
- `internal/server/jsonrpc.go` - JSON-RPC 2.0 request/response/notification types and error helpers.
- `internal/server/server.go` - static file serving, WebSocket upgrade, token subprotocol validation, WebSocket request loop.
- `internal/testutil/fixtures.go` - SGF fixtures and fake KataGo result helpers.

When implementing the tasks below, use this package layout even where an older task name mentions a more granular package. The mapping is: `domain`, `sgf`, and analysis normalization belong in `internal/game`; `workspace`, scheduler, and RPC handlers belong in `internal/app`; `protocol` and `httpserver` belong in `internal/server`; `storage` is named `internal/store`.

Create these frontend areas:

- `web/src/api/jsonrpc.ts` - WebSocket JSON-RPC client, token subprotocol, reconnect.
- `web/src/api/types.ts` - TypeScript mirror of the v1 protocol payloads.
- `web/src/state/appStore.ts` - React state reducer for connection, games, snapshot, analysis, UI mode.
- `web/src/App.tsx` - top-level token gate and app layout.
- `web/src/components/GameSidebar.tsx` - import, list, rename, delete.
- `web/src/components/Board.tsx` - self-rendered 19x19 board, stones, candidates, PV animation.
- `web/src/components/NavigationControls.tsx` - first/prev/next/last/back-to-main/pass/branch controls.
- `web/src/components/AnalysisPanel.tsx` - current position, candidate list, engine status.
- `web/src/components/AnalysisCharts.tsx` - ECharts winrate/score curves.
- `web/src/components/BadMoveList.tsx` - KaTrain-threshold mistake list.
- `web/src/components/RotatePrompt.tsx` - portrait mobile rotation prompt.
- `web/src/pwa/registerServiceWorker.ts` - service worker registration.
- `web/public/manifest.webmanifest` and `web/public/sw.js` - basic PWA shell.
- `e2e/jcgo.spec.ts` - Playwright smoke flow.

Each task below should end with a commit. If the worker is running without git commit permissions, leave the working tree staged and write the commit command output into the task notes.

### Task 1: Project Toolchain Scaffold

**Files:**
- Create: `go.mod`
- Create: `cmd/jcgo/main.go`
- Create: `internal/testutil/fixtures.go`
- Create: `testdata/sgf/simple-19.sgf`
- Create: `testdata/sgf/handicap-19.sgf`
- Create: `web/package.json`
- Create: `web/index.html`
- Create: `web/tsconfig.json`
- Create: `web/vite.config.ts`
- Create: `web/src/main.tsx`
- Create: `web/src/App.tsx`
- Create: `web/src/styles.css`
- Modify: `README.md`

- [x] **Step 1: Create the Go module and backend entrypoint skeleton**

Create `go.mod` with this module name:

```go
module jcgo

go 1.23
```

Create `cmd/jcgo/main.go` with a minimal executable that will be expanded later:

```go
package main

import "fmt"

func main() {
	fmt.Println("jcgo server scaffold")
}
```

- [x] **Step 2: Create fixture SGFs**

Create `testdata/sgf/simple-19.sgf`:

```sgf
(;GM[1]FF[4]SZ[19]KM[7.5]RU[chinese]PB[Black]PW[White]RE[B+R];B[pd];W[dd];B[qp];W[dp])
```

Create `testdata/sgf/handicap-19.sgf`:

```sgf
(;GM[1]FF[4]SZ[19]KM[0.5]RU[chinese]HA[2]AB[dd][pp]PB[Black]PW[White]RE[W+2.5];W[pd];B[dp])
```

Create `internal/testutil/fixtures.go`:

```go
package testutil

import (
	"os"
	"path/filepath"
	"testing"
)

func ReadFixture(t *testing.T, name string) string {
	t.Helper()
	path := filepath.Join("..", "..", "testdata", "sgf", name)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return string(data)
}
```

- [x] **Step 3: Create the Vite React TypeScript shell**

Run:

```powershell
npm create vite@latest web -- --template react-ts
```

Expected: `web/package.json`, `web/src/main.tsx`, and `web/src/App.tsx` exist.

Then install v1 dependencies:

```powershell
cd web
npm install
npm install echarts echarts-for-react lucide-react
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event playwright
```

Expected: `npm` exits with code `0`.

- [x] **Step 4: Replace the starter app with a neutral shell**

Replace `web/src/App.tsx`:

```tsx
import './styles.css'

export default function App() {
  return (
    <main className="app-shell">
      <h1>JCGO</h1>
      <p>Remote KataGo analysis review workspace</p>
    </main>
  )
}
```

Create `web/src/styles.css`:

```css
:root {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #172026;
  background: #f5f1e8;
}

body {
  margin: 0;
}

.app-shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  text-align: center;
}
```

- [x] **Step 5: Verify scaffold commands**

Run:

```powershell
go run .\cmd\jcgo
```

Expected:

```text
jcgo server scaffold
```

Run:

```powershell
cd web
npm run build
```

Expected: Vite build completes and creates `web/dist`.

- [x] **Step 6: Commit**

```powershell
git add go.mod cmd internal testdata web README.md
git commit -m "chore: scaffold jcgo toolchain"
```

### Task 2: Runtime Config and App Directories

**Files:**
- Create: `internal/config/config.go`
- Create: `internal/config/config_test.go`
- Modify: `cmd/jcgo/main.go`

- [x] **Step 1: Write the failing config test**

Create `internal/config/config_test.go`:

```go
package config

import (
	"path/filepath"
	"testing"
)

func TestLoadDefaultsFromEnvironment(t *testing.T) {
	t.Setenv("JCGO_ACCESS_TOKEN", "secret-token")
	t.Setenv("JCGO_DATA_DIR", t.TempDir())
	t.Setenv("JCGO_KATAGO_PATH", filepath.Join("bin", "katago"))
	t.Setenv("JCGO_MODEL_PATH", filepath.Join("models", "kata.bin.gz"))
	t.Setenv("JCGO_ANALYSIS_CONFIG_PATH", filepath.Join("cfg", "analysis.cfg"))

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.AccessToken != "secret-token" {
		t.Fatalf("AccessToken = %q", cfg.AccessToken)
	}
	if cfg.ListenAddr != "127.0.0.1:4380" {
		t.Fatalf("ListenAddr = %q", cfg.ListenAddr)
	}
	if cfg.MaxVisits != 500 {
		t.Fatalf("MaxVisits = %d", cfg.MaxVisits)
	}
}

func TestLoadRejectsMissingToken(t *testing.T) {
	t.Setenv("JCGO_ACCESS_TOKEN", "")
	_, err := Load()
	if err == nil {
		t.Fatal("Load returned nil error for missing token")
	}
}
```

- [x] **Step 2: Run the test to verify it fails**

Run:

```powershell
go test .\internal\config -run TestLoad -count=1
```

Expected: FAIL because `Load` is undefined.

- [x] **Step 3: Implement config loading**

Create `internal/config/config.go`:

```go
package config

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"
)

type Config struct {
	ListenAddr         string
	AccessToken        string
	DataDir            string
	DatabasePath       string
	GamesDir           string
	KatagoPath         string
	ModelPath          string
	AnalysisConfigPath string
	MaxVisits          int
}

func Load() (Config, error) {
	dataDir := env("JCGO_DATA_DIR", filepath.Join(".", "data"))
	maxVisits := envInt("JCGO_MAX_VISITS", 500)
	cfg := Config{
		ListenAddr:         env("JCGO_LISTEN_ADDR", "127.0.0.1:4380"),
		AccessToken:        os.Getenv("JCGO_ACCESS_TOKEN"),
		DataDir:            dataDir,
		DatabasePath:       filepath.Join(dataDir, "jcgo.sqlite"),
		GamesDir:           filepath.Join(dataDir, "games"),
		KatagoPath:         os.Getenv("JCGO_KATAGO_PATH"),
		ModelPath:          os.Getenv("JCGO_MODEL_PATH"),
		AnalysisConfigPath: os.Getenv("JCGO_ANALYSIS_CONFIG_PATH"),
		MaxVisits:          maxVisits,
	}
	if cfg.AccessToken == "" {
		return Config{}, errors.New("JCGO_ACCESS_TOKEN is required")
	}
	return cfg, nil
}

func EnsureDirs(cfg Config) error {
	if err := os.MkdirAll(cfg.GamesDir, 0o755); err != nil {
		return err
	}
	return os.MkdirAll(filepath.Dir(cfg.DatabasePath), 0o755)
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envInt(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}
```

- [x] **Step 4: Wire config into `main`**

Replace `cmd/jcgo/main.go`:

```go
package main

import (
	"fmt"
	"log"

	"jcgo/internal/config"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	if err := config.EnsureDirs(cfg); err != nil {
		log.Fatal(err)
	}
	fmt.Printf("jcgo listening on %s\n", cfg.ListenAddr)
}
```

- [x] **Step 5: Verify config tests pass**

Run:

```powershell
go test .\internal\config -count=1
```

Expected: PASS.

- [x] **Step 6: Commit**

```powershell
git add cmd internal/config
git commit -m "feat: add runtime config"
```

### Task 3: JSON-RPC and WebSocket Token Handshake

**Files:**
- Create: `internal/protocol/jsonrpc.go`
- Create: `internal/protocol/jsonrpc_test.go`
- Create: `internal/httpserver/server.go`
- Create: `internal/httpserver/server_test.go`
- Modify: `cmd/jcgo/main.go`

- [x] **Step 1: Write JSON-RPC tests**

Create `internal/protocol/jsonrpc_test.go`:

```go
package protocol

import (
	"encoding/json"
	"testing"
)

func TestDecodeRequest(t *testing.T) {
	var req Request
	err := json.Unmarshal([]byte(`{"jsonrpc":"2.0","id":"7","method":"game.list","params":{"x":1}}`), &req)
	if err != nil {
		t.Fatal(err)
	}
	if req.Method != "game.list" || req.ID.String() != "7" {
		t.Fatalf("decoded request = %#v", req)
	}
}

func TestErrorResponseShape(t *testing.T) {
	resp := ErrorResponse("7", CodeInvalidRequest, "bad request")
	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"jsonrpc":"2.0","id":"7","error":{"code":-32600,"message":"bad request"}}`
	if string(data) != want {
		t.Fatalf("json = %s", data)
	}
}
```

- [x] **Step 2: Implement JSON-RPC types**

Create `internal/protocol/jsonrpc.go`:

```go
package protocol

import "encoding/json"

const Version = "2.0"

const (
	CodeParseError     = -32700
	CodeInvalidRequest = -32600
	CodeMethodNotFound = -32601
	CodeInvalidParams  = -32602
	CodeInternalError  = -32603
)

type Request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type Response struct {
	JSONRPC string      `json:"jsonrpc"`
	ID      string      `json:"id,omitempty"`
	Result  any         `json:"result,omitempty"`
	Error   *RPCError   `json:"error,omitempty"`
}

type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type Notification struct {
	JSONRPC string `json:"jsonrpc"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

func ResultResponse(id string, result any) Response {
	return Response{JSONRPC: Version, ID: id, Result: result}
}

func ErrorResponse(id string, code int, message string) Response {
	return Response{JSONRPC: Version, ID: id, Error: &RPCError{Code: code, Message: message}}
}

func Notify(method string, params any) Notification {
	return Notification{JSONRPC: Version, Method: method, Params: params}
}
```

- [x] **Step 3: Write WebSocket handshake tests**

Create `internal/httpserver/server_test.go`:

```go
package httpserver

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
```

- [x] **Step 4: Run tests to verify they fail**

Run:

```powershell
go test .\internal\protocol .\internal\httpserver -count=1
```

Expected: protocol tests pass after Step 2; httpserver package fails because `New` and `Config` are undefined.

- [x] **Step 5: Install Gorilla WebSocket and implement the server**

Run:

```powershell
go get github.com/gorilla/websocket@latest
```

Create `internal/httpserver/server.go`:

```go
package httpserver

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
	ServeWS(*websocket.Conn)
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
	if !validSubprotocol(r.Header.Values("Sec-Websocket-Protocol"), s.cfg.AccessToken) {
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
	s.handler.ServeWS(conn)
}

func validSubprotocol(values []string, token string) bool {
	wantToken := "token." + token
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
	return foundRPC && foundToken
}
```

- [x] **Step 6: Wire HTTP server in `main`**

Replace `cmd/jcgo/main.go`:

```go
package main

import (
	"log"
	"net/http"

	"jcgo/internal/config"
	"jcgo/internal/httpserver"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	if err := config.EnsureDirs(cfg); err != nil {
		log.Fatal(err)
	}
	server := httpserver.New(httpserver.Config{AccessToken: cfg.AccessToken}, nil)
	log.Printf("jcgo listening on %s", cfg.ListenAddr)
	log.Fatal(http.ListenAndServe(cfg.ListenAddr, server.Handler()))
}
```

- [x] **Step 7: Verify tests pass**

Run:

```powershell
go test .\internal\protocol .\internal\httpserver -count=1
```

Expected: PASS.

- [x] **Step 8: Commit**

```powershell
git add go.mod go.sum cmd internal/protocol internal/httpserver
git commit -m "feat: add jsonrpc websocket handshake"
```

### Task 4: SQLite Game Repository and SGF File Store

**Files:**
- Create: `internal/storage/repository.go`
- Create: `internal/storage/files.go`
- Create: `internal/storage/storage_test.go`

- [x] **Step 1: Write storage tests**

Create `internal/storage/storage_test.go`:

```go
package storage

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestRepositoryCreatesListsRenamesAndDeletesGames(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	repo, err := Open(ctx, filepath.Join(dir, "jcgo.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()

	game, err := repo.CreateGame(ctx, CreateGameInput{
		DisplayName: "Demo",
		Result:      "B+R",
		SGFFilename: "game-1.sgf",
	})
	if err != nil {
		t.Fatal(err)
	}
	if game.DisplayName != "Demo" || game.Result != "B+R" {
		t.Fatalf("game = %#v", game)
	}

	if err := repo.RenameGame(ctx, game.ID, "Renamed"); err != nil {
		t.Fatal(err)
	}
	games, err := repo.ListGames(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(games) != 1 || games[0].DisplayName != "Renamed" {
		t.Fatalf("games = %#v", games)
	}

	if err := repo.DeleteGame(ctx, game.ID); err != nil {
		t.Fatal(err)
	}
	games, err = repo.ListGames(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(games) != 0 {
		t.Fatalf("games after delete = %#v", games)
	}
}

func TestFileStoreWritesAndDeletesSGF(t *testing.T) {
	dir := t.TempDir()
	store := NewFileStore(dir)
	path, err := store.WriteSGF("game-1", "(;SZ[19])")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(path) != "game-1.sgf" {
		t.Fatalf("path = %s", path)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteSGF("game-1.sgf"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("expected deleted file, stat err = %v", err)
	}
}
```

- [x] **Step 2: Run tests to verify they fail**

Run:

```powershell
go test .\internal\storage -count=1
```

Expected: FAIL because storage types are undefined.

- [x] **Step 3: Add SQLite dependency and repository implementation**

Run:

```powershell
go get modernc.org/sqlite@latest
```

Create `internal/storage/repository.go` with these exported types and methods:

```go
package storage

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"time"

	_ "modernc.org/sqlite"
)

type GameRecord struct {
	ID          string    `json:"gameId"`
	DisplayName string    `json:"displayName"`
	Result      string    `json:"result"`
	SGFFilename string    `json:"sgfFilename"`
	CreatedAt   time.Time `json:"createdAt"`
}

type CreateGameInput struct {
	DisplayName string
	Result      string
	SGFFilename string
}

type Repository struct {
	db *sql.DB
}

func Open(ctx context.Context, path string) (*Repository, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	repo := &Repository{db: db}
	if err := repo.migrate(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return repo, nil
}

func (r *Repository) Close() error {
	return r.db.Close()
}

func (r *Repository) migrate(ctx context.Context) error {
	_, err := r.db.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS games (
	id TEXT PRIMARY KEY,
	display_name TEXT NOT NULL,
	result TEXT NOT NULL,
	sgf_filename TEXT NOT NULL,
	created_at TEXT NOT NULL
);`)
	return err
}

func (r *Repository) CreateGame(ctx context.Context, in CreateGameInput) (GameRecord, error) {
	id, err := newID()
	if err != nil {
		return GameRecord{}, err
	}
	record := GameRecord{
		ID:          id,
		DisplayName: in.DisplayName,
		Result:      in.Result,
		SGFFilename: in.SGFFilename,
		CreatedAt:   time.Now().UTC(),
	}
	_, err = r.db.ExecContext(ctx, `INSERT INTO games(id, display_name, result, sgf_filename, created_at) VALUES (?, ?, ?, ?, ?)`,
		record.ID, record.DisplayName, record.Result, record.SGFFilename, record.CreatedAt.Format(time.RFC3339Nano))
	if err != nil {
		return GameRecord{}, err
	}
	return record, nil
}

func (r *Repository) ListGames(ctx context.Context) ([]GameRecord, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, display_name, result, sgf_filename, created_at FROM games ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var records []GameRecord
	for rows.Next() {
		var rec GameRecord
		var created string
		if err := rows.Scan(&rec.ID, &rec.DisplayName, &rec.Result, &rec.SGFFilename, &created); err != nil {
			return nil, err
		}
		rec.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
		records = append(records, rec)
	}
	return records, rows.Err()
}

func (r *Repository) RenameGame(ctx context.Context, id string, displayName string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE games SET display_name = ? WHERE id = ?`, displayName, id)
	return err
}

func (r *Repository) DeleteGame(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM games WHERE id = ?`, id)
	return err
}

func newID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}
```

- [x] **Step 4: Implement SGF file store**

Create `internal/storage/files.go`:

```go
package storage

import (
	"os"
	"path/filepath"
	"strings"
)

type FileStore struct {
	dir string
}

func NewFileStore(dir string) FileStore {
	return FileStore{dir: dir}
}

func (s FileStore) WriteSGF(gameID string, sgfText string) (string, error) {
	filename := gameID + ".sgf"
	path := filepath.Join(s.dir, filename)
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return "", err
	}
	return path, os.WriteFile(path, []byte(sgfText), 0o644)
}

func (s FileStore) ReadSGF(filename string) (string, error) {
	path := filepath.Join(s.dir, filepath.Base(filename))
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (s FileStore) DeleteSGF(filename string) error {
	clean := filepath.Base(strings.TrimSpace(filename))
	return os.Remove(filepath.Join(s.dir, clean))
}
```

- [x] **Step 5: Verify storage tests pass**

Run:

```powershell
go test .\internal\storage -count=1
```

Expected: PASS.

- [x] **Step 6: Commit**

```powershell
git add go.mod go.sum internal/storage
git commit -m "feat: add game storage"
```

### Task 5: SGF Parser and v1 Import Validation

**Files:**
- Create: `internal/game/sgf.go`
- Create: `internal/game/sgf_test.go`

- [x] **Step 1: Write parser tests**

Create `internal/game/sgf_test.go`:

```go
package game

import "testing"

func TestParseMainlineSimple19(t *testing.T) {
	doc, err := ParseSGF(`(;GM[1]FF[4]SZ[19]KM[7.5]RU[chinese]PB[Black]PW[White]RE[B+R];B[pd];W[dd](;B[qq])(;B[pp]))`)
	if err != nil {
		t.Fatal(err)
	}
	if doc.BoardSize != 19 || doc.Komi != 7.5 || doc.Rules != "chinese" || doc.Result != "B+R" {
		t.Fatalf("doc = %#v", doc)
	}
	if len(doc.Mainline) != 2 {
		t.Fatalf("mainline length = %d", len(doc.Mainline))
	}
	if doc.Mainline[0].GTP != "Q16" || doc.Mainline[1].GTP != "D16" {
		t.Fatalf("mainline = %#v", doc.Mainline)
	}
}

func TestParseDefaultsRulesAndKomi(t *testing.T) {
	doc, err := ParseSGF(`(;GM[1]FF[4]SZ[19];B[pd])`)
	if err != nil {
		t.Fatal(err)
	}
	if doc.Rules != "chinese" || doc.Komi != 7.5 {
		t.Fatalf("defaults = %s %.1f", doc.Rules, doc.Komi)
	}
}

func TestParseRejectsNonRootSetup(t *testing.T) {
	_, err := ParseSGF(`(;GM[1]FF[4]SZ[19];B[pd]AB[dd])`)
	if err == nil {
		t.Fatal("expected non-root setup rejection")
	}
}

func TestParseRootSetup(t *testing.T) {
	doc, err := ParseSGF(`(;GM[1]FF[4]SZ[19]HA[2]AB[dd][pp];W[pd])`)
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.InitialStones) != 2 || doc.Mainline[0].GTP != "Q16" {
		t.Fatalf("doc = %#v", doc)
	}
}
```

- [x] **Step 2: Run parser tests to verify they fail**

Run:

```powershell
go test .\internal\game -count=1
```

Expected: FAIL because parser types are undefined.

- [x] **Step 3: Implement v1 SGF parser**

Create `internal/game/sgf.go` with these exported types:

```go
package game

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode"
)

type Color string

const (
	Black Color = "B"
	White Color = "W"
)

type Move struct {
	Player Color
	GTP    string
	Pass   bool
}

type Stone struct {
	Player Color
	GTP    string
}

type SGFDocument struct {
	BoardSize     int
	Rules         string
	Komi          float64
	Result        string
	InitialStones []Stone
	Mainline      []Move
}
```

Then implement:

```go
func ParseSGF(input string) (SGFDocument, error) {
	nodes, err := parseNodes(input)
	if err != nil {
		return SGFDocument{}, err
	}
	if len(nodes) == 0 {
		return SGFDocument{}, errors.New("sgf contains no nodes")
	}
	root := nodes[0]
	doc := SGFDocument{
		BoardSize: 19,
		Rules:     "chinese",
		Komi:      7.5,
		Result:    first(root["RE"]),
	}
	if size := first(root["SZ"]); size != "" {
		parsed, err := strconv.Atoi(size)
		if err != nil || parsed != 19 {
			return SGFDocument{}, fmt.Errorf("only 19x19 SGF is supported")
		}
		doc.BoardSize = parsed
	}
	if rules := first(root["RU"]); rules != "" {
		doc.Rules = strings.ToLower(rules)
	}
	if komi := first(root["KM"]); komi != "" {
		parsed, err := strconv.ParseFloat(komi, 64)
		if err != nil {
			return SGFDocument{}, fmt.Errorf("invalid komi %q", komi)
		}
		doc.Komi = parsed
	}
	for _, raw := range root["AB"] {
		doc.InitialStones = append(doc.InitialStones, Stone{Player: Black, GTP: sgfCoordToGTP(raw)})
	}
	for _, raw := range root["AW"] {
		doc.InitialStones = append(doc.InitialStones, Stone{Player: White, GTP: sgfCoordToGTP(raw)})
	}
	for i, node := range nodes[1:] {
		if len(node["AB"]) > 0 || len(node["AW"]) > 0 || len(node["AE"]) > 0 {
			return SGFDocument{}, fmt.Errorf("unsupported setup property outside root at node %d", i+1)
		}
		if values := node["B"]; len(values) > 0 {
			doc.Mainline = append(doc.Mainline, Move{Player: Black, GTP: sgfCoordToGTP(values[0]), Pass: values[0] == ""})
		}
		if values := node["W"]; len(values) > 0 {
			doc.Mainline = append(doc.Mainline, Move{Player: White, GTP: sgfCoordToGTP(values[0]), Pass: values[0] == ""})
		}
	}
	return doc, nil
}
```

Implement `parseNodes` as a mainline-only SGF scanner: enter the first game tree after `(`, read sequential `;` nodes, and skip SGF child branches once the imported mainline reaches a branch point. Preserve escaped `\]` inside property values. Use KaTrain `sgf_parser.py` lines around `SGF._parse_branch` as behavior reference.

- [x] **Step 4: Verify parser tests pass**

Run:

```powershell
go test .\internal\game -count=1
```

Expected: PASS.

- [x] **Step 5: Commit**

```powershell
git add internal/game
git commit -m "feat: parse v1 sgf mainline"
```

### Task 6: Game Rules, Snapshots, and Mainline Navigation

**Files:**
- Create: `internal/game/types.go`
- Create: `internal/game/board.go`
- Create: `internal/game/game.go`
- Create: `internal/game/game_test.go`

- [x] **Step 1: Write game rules tests**

Create `internal/game/game_test.go`:

```go
package game

import (
	"testing"

	"jcgo/internal/sgf"
)

func TestLoadMainlineAndSnapshots(t *testing.T) {
	doc, err := sgf.Parse(`(;GM[1]FF[4]SZ[19]KM[7.5]RU[chinese];B[pd];W[dd];B[qp])`)
	if err != nil {
		t.Fatal(err)
	}
	g, err := NewFromSGF("game-1", doc)
	if err != nil {
		t.Fatal(err)
	}
	snap, err := g.GotoMain(2)
	if err != nil {
		t.Fatal(err)
	}
	if snap.MoveNumber != 2 || snap.TotalMoves != 3 || snap.LastMove == nil || snap.LastMove.GTP != "D16" {
		t.Fatalf("snapshot = %#v", snap)
	}
	if len(snap.Stones) != 2 {
		t.Fatalf("stones = %#v", snap.Stones)
	}
}

func TestCaptureAndPassEndState(t *testing.T) {
	g := NewEmpty("game-1", "chinese", 7.5)
	mustPlay(t, g, "B", "B2")
	mustPlay(t, g, "W", "A2")
	mustPlay(t, g, "B", "A1")
	mustPlay(t, g, "W", "pass")
	mustPlay(t, g, "B", "pass")
	snap := g.CurrentSnapshot()
	if !snap.GameEnded {
		t.Fatalf("GameEnded = false")
	}
}

func mustPlay(t *testing.T, g *Game, color string, gtp string) {
	t.Helper()
	if _, err := g.PlayVariation(color, gtp); err != nil {
		t.Fatalf("play %s %s: %v", color, gtp, err)
	}
}
```

- [x] **Step 2: Run tests to verify they fail**

Run:

```powershell
go test .\internal\game -count=1
```

Expected: FAIL because `NewFromSGF`, `NewEmpty`, and `Game` are undefined.

- [x] **Step 3: Create shared game types**

Create `internal/game/types.go`:

```go
package game

type Color string

const (
	Black Color = "B"
	White Color = "W"
)

type Point struct {
	X int `json:"x"`
	Y int `json:"y"`
}

type Stone struct {
	X     int   `json:"x"`
	Y     int   `json:"y"`
	Color Color `json:"color"`
}

type MoveView struct {
	NodeID string `json:"nodeId"`
	MoveNumber int `json:"moveNumber"`
	Color Color `json:"color"`
	GTP string `json:"gtp"`
	Pass bool `json:"pass"`
}

type Snapshot struct {
	GameID string `json:"gameId"`
	NodeID string `json:"nodeId"`
	MoveNumber int `json:"moveNumber"`
	TotalMoves int `json:"totalMoves"`
	BranchMode string `json:"branchMode"`
	Stones []Stone `json:"stones"`
	LastMove *MoveView `json:"lastMove,omitempty"`
	ToPlay Color `json:"toPlay"`
	Rules string `json:"rules"`
	Komi float64 `json:"komi"`
	Captures map[Color]int `json:"captures"`
	GameEnded bool `json:"gameEnded"`
	CanPrevious bool `json:"canPrevious"`
	CanNext bool `json:"canNext"`
	CanBackToMain bool `json:"canBackToMain"`
}
```

- [x] **Step 4: Implement board legality**

Create `internal/game/board.go` with:

```go
package game

import (
	"fmt"

	"jcgo/internal/domain"
)

type board struct {
	grid [19][19]domain.Color
}

func (b *board) place(color domain.Color, x int, y int) error {
	if x < 0 || x >= 19 || y < 0 || y >= 19 {
		return fmt.Errorf("move outside board")
	}
	if b.grid[y][x] != "" {
		return fmt.Errorf("point occupied")
	}
	b.grid[y][x] = color
	return nil
}

func (b board) stones() []domain.Stone {
	var stones []domain.Stone
	for y := 0; y < 19; y++ {
		for x := 0; x < 19; x++ {
			if b.grid[y][x] != "" {
				stones = append(stones, domain.Stone{X: x, Y: y, Color: b.grid[y][x]})
			}
		}
	}
	return stones
}
```

Extend this file in the same task to remove opponent groups with zero liberties, reject suicide, and track captures. Use a flood-fill group helper over four orthogonal neighbors. Preserve Ko state as a single forbidden point for the immediately following move.

- [x] **Step 5: Implement game model and snapshots**

Create `internal/game/game.go` with exported API:

```go
package game

import (
	"fmt"
	"strconv"
	"strings"

	"jcgo/internal/domain"
	"jcgo/internal/sgf"
)

type Game struct {
	id string
	rules string
	komi float64
	mainline []node
	current string
}

type node struct {
	id string
	parent string
	moveNumber int
	color domain.Color
	gtp string
	pass bool
	board board
	toPlay domain.Color
	gameEnded bool
}

func NewEmpty(id string, rules string, komi float64) *Game {
	root := node{id: "main:0", moveNumber: 0, toPlay: domain.Black}
	return &Game{id: id, rules: rules, komi: komi, mainline: []node{root}, current: root.id}
}

func NewFromSGF(id string, doc sgf.Document) (*Game, error) {
	g := NewEmpty(id, doc.Rules, doc.Komi)
	for _, stone := range doc.InitialStones {
		color := domain.Color(stone.Player)
		x, y, err := ParseGTP(stone.GTP)
		if err != nil {
			return nil, err
		}
		if err := g.mainline[0].board.place(color, x, y); err != nil {
			return nil, err
		}
	}
	prev := g.mainline[0]
	for i, move := range doc.Mainline {
		next, err := playNode(prev, domain.Color(move.Player), move.GTP, fmt.Sprintf("main:%d", i+1), i+1)
		if err != nil {
			return nil, err
		}
		g.mainline = append(g.mainline, next)
		prev = next
	}
	g.current = "main:0"
	return g, nil
}
```

Complete this file with `GotoMain`, `CurrentSnapshot`, `PlayVariation`, `ParseGTP`, `FormatGTP`, and `opponent`. Use node IDs `main:<moveNumber>` for mainline and branch IDs added in Task 7.

- [x] **Step 6: Verify game tests pass**

Run:

```powershell
go test .\internal\game -count=1
```

Expected: PASS.

- [x] **Step 7: Commit**

```powershell
git add internal/game
git commit -m "feat: add game rules snapshots"
```

### Task 7: Token Workspace and Variation State

**Files:**
- Create: `internal/app/workspace.go`
- Create: `internal/app/workspace_test.go`
- Modify: `internal/game/game.go`

- [x] **Step 1: Write workspace tests**

Create `internal/app/workspace_test.go`:

```go
package app

import (
	"testing"

	"jcgo/internal/sgf"
)

func TestWorkspaceRecoversSameTokenState(t *testing.T) {
	store := NewStore()
	ws1 := store.ForToken("secret")
	ws2 := store.ForToken("secret")
	if ws1 != ws2 {
		t.Fatal("same token did not return same workspace")
	}
}

func TestVariationSurvivesReconnectInProcess(t *testing.T) {
	doc, err := sgf.Parse(`(;GM[1]FF[4]SZ[19];B[pd];W[dd])`)
	if err != nil {
		t.Fatal(err)
	}
	ws := NewStore().ForToken("secret")
	if err := ws.LoadGame("game-1", doc); err != nil {
		t.Fatal(err)
	}
	if _, err := ws.Play("game-1", "D4"); err != nil {
		t.Fatal(err)
	}
	snap, err := ws.CurrentSnapshot("game-1")
	if err != nil {
		t.Fatal(err)
	}
	if snap.BranchMode != "variation" || !snap.CanBackToMain {
		t.Fatalf("snapshot = %#v", snap)
	}
}
```

- [x] **Step 2: Run tests to verify they fail**

Run:

```powershell
go test .\internal\app -count=1
```

Expected: FAIL because workspace package is missing.

- [x] **Step 3: Implement workspace store**

Create `internal/app/workspace.go`:

```go
package app

import (
	"crypto/sha256"
	"encoding/hex"
	"sync"

	"jcgo/internal/domain"
	"jcgo/internal/game"
	"jcgo/internal/sgf"
)

type Store struct {
	mu sync.Mutex
	workspaces map[string]*Workspace
}

type Workspace struct {
	mu sync.Mutex
	games map[string]*game.Game
	selectedGameID string
}

func NewStore() *Store {
	return &Store{workspaces: map[string]*Workspace{}}
}

func (s *Store) ForToken(token string) *Workspace {
	sum := sha256.Sum256([]byte(token))
	key := hex.EncodeToString(sum[:])
	s.mu.Lock()
	defer s.mu.Unlock()
	if ws := s.workspaces[key]; ws != nil {
		return ws
	}
	ws := &Workspace{games: map[string]*game.Game{}}
	s.workspaces[key] = ws
	return ws
}

func (w *Workspace) LoadGame(gameID string, doc sgf.Document) error {
	g, err := game.NewFromSGF(gameID, doc)
	if err != nil {
		return err
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	w.games[gameID] = g
	w.selectedGameID = gameID
	return nil
}

func (w *Workspace) CurrentSnapshot(gameID string) (domain.Snapshot, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.games[gameID].CurrentSnapshot(), nil
}

func (w *Workspace) Play(gameID string, gtp string) (domain.Snapshot, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	g := w.games[gameID]
	color := string(g.CurrentSnapshot().ToPlay)
	return g.PlayVariation(color, gtp)
}
```

- [x] **Step 4: Extend game variations**

Modify `internal/game/game.go` so `Game` stores variation nodes in memory and supports:

```go
func (g *Game) BackToMain() (domain.Snapshot, error)
func (g *Game) DeleteCurrentVariationNode() (domain.Snapshot, error)
func (g *Game) ClearCurrentVariation() (domain.Snapshot, error)
```

Use branch node IDs in the form `var:<counter>`. Store the mainline fork move number on each variation node so `BackToMain` and `ClearCurrentVariation` return to the correct `main:<n>` node.

- [x] **Step 5: Verify workspace and game tests pass**

Run:

```powershell
go test .\internal\game .\internal\app -count=1
```

Expected: PASS.

- [x] **Step 6: Commit**

```powershell
git add internal/game internal/app
git commit -m "feat: add token workspace variations"
```

### Task 8: Game JSON-RPC Handlers

**Files:**
- Create: `internal/app/handlers.go`
- Create: `internal/app/handlers_test.go`
- Modify: `internal/app/workspace.go`
- Modify: `internal/store/repository.go`
- Modify: `cmd/jcgo/main.go`

- [x] **Step 1: Write handler tests**

Create `internal/app/handlers_test.go`:

```go
package app

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"

	"jcgo/internal/storage"
	"jcgo/internal/workspace"
)

func TestImportListRenameDeleteGame(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	repo, err := storage.Open(ctx, filepath.Join(dir, "jcgo.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	h := New(repo, storage.NewFileStore(filepath.Join(dir, "games")), workspace.NewStore(), nil)

	result, err := h.Call(ctx, "secret", "game.importSgf", json.RawMessage(`{"displayName":"Demo","originalFilename":"demo.sgf","sgfText":"(;GM[1]FF[4]SZ[19]RE[B+R];B[pd])"}`))
	if err != nil {
		t.Fatal(err)
	}
	imported := result.(ImportResult)
	if imported.Game.DisplayName != "Demo" || imported.Snapshot.MoveNumber != 0 {
		t.Fatalf("imported = %#v", imported)
	}

	if _, err := h.Call(ctx, "secret", "game.rename", json.RawMessage(`{"gameId":"`+imported.Game.ID+`","displayName":"Renamed"}`)); err != nil {
		t.Fatal(err)
	}
	listResult, err := h.Call(ctx, "secret", "game.list", nil)
	if err != nil {
		t.Fatal(err)
	}
	if listResult.(ListResult).Games[0].DisplayName != "Renamed" {
		t.Fatalf("list = %#v", listResult)
	}
}
```

- [x] **Step 2: Run handler tests to verify they fail**

Run:

```powershell
go test .\internal\app -count=1
```

Expected: FAIL because `New` is undefined.

- [x] **Step 3: Implement handler service**

Create `internal/app/handlers.go` with:

```go
package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"jcgo/internal/domain"
	"jcgo/internal/sgf"
	"jcgo/internal/storage"
	"jcgo/internal/workspace"
)

type AnalysisController interface {
	Start(gameID string, focusNodeID string) error
	Stop(gameID string) error
	Restart(gameID string, focusNodeID string) error
}

type Handler struct {
	repo *storage.Repository
	files storage.FileStore
	workspaces *workspace.Store
	analysis AnalysisController
}

type ImportResult struct {
	Game storage.GameRecord `json:"game"`
	Snapshot domain.Snapshot `json:"snapshot"`
}

type ListResult struct {
	Games []storage.GameRecord `json:"games"`
}

func New(repo *storage.Repository, files storage.FileStore, workspaces *workspace.Store, analysis AnalysisController) *Handler {
	return &Handler{repo: repo, files: files, workspaces: workspaces, analysis: analysis}
}

func (h *Handler) Call(ctx context.Context, token string, method string, params json.RawMessage) (any, error) {
	switch method {
	case "game.list":
		games, err := h.repo.ListGames(ctx)
		return ListResult{Games: games}, err
	case "game.importSgf":
		return h.importSGF(ctx, token, params)
	case "game.rename":
		return h.rename(ctx, params)
	case "game.delete":
		return h.delete(ctx, token, params)
	default:
		return nil, errors.New("method not found")
	}
}
```

Implement `importSGF`, `rename`, `delete`, `game.select`, `game.goto`, `game.play`, `game.pass`, `game.backToMain`, `game.deleteVariationNode`, `game.clearVariation`, `analysis.start`, `analysis.stop`, `analysis.restart`, and `workspace.snapshot`. Reject trimmed empty display names. For import, parse SGF first, create a storage record, write `<game_id>.sgf`, then load the parsed game into the token workspace.

- [x] **Step 4: Connect JSON-RPC loop to WebSocket**

Use the existing `internal/server` WebSocket token handoff interface:

```go
type RPCHandler interface {
	ServeWS(token string, conn *websocket.Conn)
}
```

Implement request read loop in `internal/app/handlers.go`:

```go
func (h *Handler) ServeWS(token string, conn *websocket.Conn) {
	defer conn.Close()
	ctx := context.Background()
	for {
		var req protocol.Request
		if err := conn.ReadJSON(&req); err != nil {
			return
		}
		id := string(req.ID)
		id = strings.Trim(id, `"`)
		result, err := h.Call(ctx, token, req.Method, req.Params)
		if err != nil {
			_ = conn.WriteJSON(protocol.ErrorResponse(id, protocol.CodeInternalError, err.Error()))
			continue
		}
		_ = conn.WriteJSON(protocol.ResultResponse(id, result))
	}
}
```

- [x] **Step 5: Verify handler tests pass**

Run:

```powershell
go test .\internal\app .\internal\server -count=1
```

Expected: PASS.

- [x] **Step 6: Commit**

```powershell
git add cmd internal/app internal/store internal/server
git commit -m "feat: add game jsonrpc handlers"
```

### Task 9: KataGo Process Wrapper and Fake Engine

**Files:**
- Create: `internal/katago/query.go`
- Create: `internal/katago/engine.go`
- Create: `internal/katago/engine_test.go`
- Create: `internal/testutil/fake_katago.go`

- [ ] **Step 1: Write engine tests with a fake process**

Create `internal/katago/engine_test.go`:

```go
package katago

import (
	"context"
	"testing"
)

func TestBuildQueryUsesBlackPerspectiveAndInitialStones(t *testing.T) {
	query := BuildQuery(BuildInput{
		ID: "q-1",
		Rules: "chinese",
		Komi: 7.5,
		MaxVisits: 500,
		InitialStones: []Stone{{Player: "B", Move: "D16"}},
		Moves: []Move{{Player: "B", Move: "Q16"}},
		AnalyzeTurn: 1,
	})
	if query.Rules != "chinese" || query.Komi != 7.5 || query.MaxVisits != 500 {
		t.Fatalf("query = %#v", query)
	}
	if len(query.InitialStones) != 1 || query.InitialStones[0][1] != "D16" {
		t.Fatalf("initial stones = %#v", query.InitialStones)
	}
	if !query.IncludePolicy {
		t.Fatal("IncludePolicy = false")
	}
}

func TestUnavailableEngineReturnsError(t *testing.T) {
	engine := NewUnavailable("missing katago")
	_, err := engine.Analyze(context.Background(), Query{ID: "q-1"})
	if err == nil {
		t.Fatal("Analyze returned nil error")
	}
}
```

- [ ] **Step 2: Run engine tests to verify they fail**

Run:

```powershell
go test .\internal\katago -count=1
```

Expected: FAIL because package types are undefined.

- [ ] **Step 3: Implement query structs**

Create `internal/katago/query.go`:

```go
package katago

type Move struct {
	Player string
	Move string
}

type Stone = Move

type Query struct {
	ID string `json:"id"`
	Rules string `json:"rules"`
	Priority int `json:"priority"`
	AnalyzeTurns []int `json:"analyzeTurns"`
	MaxVisits int `json:"maxVisits"`
	Komi float64 `json:"komi"`
	BoardXSize int `json:"boardXSize"`
	BoardYSize int `json:"boardYSize"`
	IncludeOwnership bool `json:"includeOwnership"`
	IncludeMovesOwnership bool `json:"includeMovesOwnership"`
	IncludePolicy bool `json:"includePolicy"`
	InitialStones [][2]string `json:"initialStones"`
	InitialPlayer string `json:"initialPlayer"`
	Moves [][2]string `json:"moves"`
	OverrideSettings map[string]any `json:"overrideSettings,omitempty"`
}

type BuildInput struct {
	ID string
	Rules string
	Komi float64
	MaxVisits int
	InitialStones []Stone
	Moves []Move
	AnalyzeTurn int
}

func BuildQuery(in BuildInput) Query {
	query := Query{
		ID: in.ID,
		Rules: in.Rules,
		AnalyzeTurns: []int{in.AnalyzeTurn},
		MaxVisits: in.MaxVisits,
		Komi: in.Komi,
		BoardXSize: 19,
		BoardYSize: 19,
		IncludePolicy: true,
		InitialPlayer: "B",
	}
	for _, stone := range in.InitialStones {
		query.InitialStones = append(query.InitialStones, [2]string{stone.Player, stone.Move})
	}
	for _, move := range in.Moves {
		query.Moves = append(query.Moves, [2]string{move.Player, move.Move})
	}
	return query
}
```

- [ ] **Step 4: Implement engine interface**

Create `internal/katago/engine.go`:

```go
package katago

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os/exec"
	"sync"
)

type Result struct {
	ID string `json:"id"`
	RootInfo RootInfo `json:"rootInfo"`
	MoveInfos []MoveInfo `json:"moveInfos"`
	IsDuringSearch bool `json:"isDuringSearch,omitempty"`
	Error string `json:"error,omitempty"`
}

type RootInfo struct {
	Visits int `json:"visits"`
	Winrate float64 `json:"winrate"`
	ScoreLead float64 `json:"scoreLead"`
}

type MoveInfo struct {
	Move string `json:"move"`
	Visits int `json:"visits"`
	Winrate float64 `json:"winrate"`
	ScoreLead float64 `json:"scoreLead"`
	Order int `json:"order"`
	PV []string `json:"pv"`
}

type Analyzer interface {
	Analyze(context.Context, Query) (Result, error)
	Available() bool
	Status() Status
	Close() error
}

type Status struct {
	Available bool `json:"available"`
	Error string `json:"error,omitempty"`
}

func NewUnavailable(message string) Analyzer {
	return unavailable{message: message}
}

type unavailable struct {
	message string
}

func (u unavailable) Analyze(context.Context, Query) (Result, error) { return Result{}, errors.New(u.message) }
func (u unavailable) Available() bool { return false }
func (u unavailable) Status() Status { return Status{Available: false, Error: u.message} }
func (u unavailable) Close() error { return nil }
```

In the same file, implement `StartLocal(ctx, katagoPath, modelPath, configPath string) (Analyzer, error)` using `exec.CommandContext(katagoPath, "analysis", "-model", modelPath, "-config", configPath)`. Maintain a mutex around stdin writes and stdout reads because v1 uses a single global queue. Decode one JSON line per `Analyze` call and return a non-partial final result.

- [ ] **Step 5: Verify engine tests pass**

Run:

```powershell
go test .\internal\katago -count=1
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add internal/katago internal/testutil
git commit -m "feat: add katago process wrapper"
```

### Task 10: Analysis Normalization, Cache, and Bad Move Thresholds

**Files:**
- Create: `internal/analysis/normalize.go`
- Create: `internal/analysis/normalize_test.go`
- Modify: `internal/domain/types.go`

- [ ] **Step 1: Write normalization tests**

Create `internal/analysis/normalize_test.go`:

```go
package analysis

import (
	"testing"

	"jcgo/internal/domain"
	"jcgo/internal/katago"
)

func TestNormalizeCandidatePointLossForBlackToPlay(t *testing.T) {
	out := Normalize(domain.Black, katago.Result{
		RootInfo: katago.RootInfo{Winrate: 0.55, ScoreLead: 3.0, Visits: 500},
		MoveInfos: []katago.MoveInfo{
			{Move: "Q16", Order: 0, Visits: 400, Winrate: 0.56, ScoreLead: 3.4, PV: []string{"Q16", "D16"}},
			{Move: "D4", Order: 1, Visits: 80, Winrate: 0.50, ScoreLead: 1.0, PV: []string{"D4"}},
		},
	})
	if out.Candidates[1].PointLoss != 2.0 {
		t.Fatalf("PointLoss = %.1f", out.Candidates[1].PointLoss)
	}
	if out.Candidates[1].LowVisits != false {
		t.Fatalf("LowVisits = true for 80 visits")
	}
}

func TestMistakeThresholdsMatchKaTrain(t *testing.T) {
	if MistakeClass(12.0) != 0 || MistakeClass(6.0) != 1 || MistakeClass(3.0) != 2 || MistakeClass(1.5) != 3 {
		t.Fatal("threshold classes do not match KaTrain default order")
	}
	if !IsBadMove(1.6) || IsBadMove(1.5) {
		t.Fatal("bad move threshold should be greater than 1.5")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
go test .\internal\analysis -count=1
```

Expected: FAIL because analysis package is missing.

- [ ] **Step 3: Add analysis types to domain**

Append to `internal/domain/types.go`:

```go
type AnalysisResult struct {
	Winrate float64 `json:"winrate"`
	ScoreLead float64 `json:"scoreLead"`
	Visits int `json:"visits"`
	Candidates []CandidateMove `json:"candidates"`
}

type CandidateMove struct {
	Move string `json:"move"`
	Order int `json:"order"`
	Visits int `json:"visits"`
	Winrate float64 `json:"winrate"`
	ScoreLead float64 `json:"scoreLead"`
	PointLoss float64 `json:"pointLoss"`
	RelativePointLoss float64 `json:"relativePointLoss"`
	WinrateLoss float64 `json:"winrateLoss"`
	PV []string `json:"pv"`
	LowVisits bool `json:"lowVisits"`
}

type BadMove struct {
	NodeID string `json:"nodeId"`
	MoveNumber int `json:"moveNumber"`
	Move string `json:"move"`
	PointLoss float64 `json:"pointLoss"`
	Class int `json:"class"`
}

type ChartPoint struct {
	MoveNumber int `json:"moveNumber"`
	Winrate float64 `json:"winrate"`
	ScoreLead float64 `json:"scoreLead"`
}
```

- [ ] **Step 4: Implement normalization**

Create `internal/analysis/normalize.go`:

```go
package analysis

import (
	"sort"

	"jcgo/internal/domain"
	"jcgo/internal/katago"
)

var KaTrainThresholds = []float64{12, 6, 3, 1.5, 0.5, 0}

func Normalize(toPlay domain.Color, result katago.Result) domain.AnalysisResult {
	rootScore := result.RootInfo.ScoreLead
	rootWinrate := result.RootInfo.Winrate
	sign := 1.0
	if toPlay == domain.White {
		sign = -1
	}
	topScore := rootScore
	for _, move := range result.MoveInfos {
		if move.Order == 0 {
			topScore = move.ScoreLead
			break
		}
	}
	out := domain.AnalysisResult{
		Winrate: rootWinrate,
		ScoreLead: rootScore,
		Visits: result.RootInfo.Visits,
	}
	for _, move := range result.MoveInfos {
		out.Candidates = append(out.Candidates, domain.CandidateMove{
			Move: move.Move,
			Order: move.Order,
			Visits: move.Visits,
			Winrate: move.Winrate,
			ScoreLead: move.ScoreLead,
			PointLoss: sign * (rootScore - move.ScoreLead),
			RelativePointLoss: sign * (topScore - move.ScoreLead),
			WinrateLoss: sign * (rootWinrate - move.Winrate),
			PV: move.PV,
			LowVisits: move.Visits < 25 && move.Order != 0,
		})
	}
	sort.SliceStable(out.Candidates, func(i, j int) bool {
		if out.Candidates[i].Order != out.Candidates[j].Order {
			return out.Candidates[i].Order < out.Candidates[j].Order
		}
		return out.Candidates[i].PointLoss < out.Candidates[j].PointLoss
	})
	return out
}

func MistakeClass(pointsLost float64) int {
	i := 0
	for i < len(KaTrainThresholds)-1 && pointsLost < KaTrainThresholds[i] {
		i++
	}
	return i
}

func IsBadMove(pointsLost float64) bool {
	return pointsLost > 1.5
}
```

- [ ] **Step 5: Verify normalization tests pass**

Run:

```powershell
go test .\internal\analysis .\internal\domain -count=1
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add internal/analysis internal/domain
git commit -m "feat: normalize analysis results"
```

### Task 11: Single Analysis Queue and Notifications

**Files:**
- Create: `internal/analysis/scheduler.go`
- Create: `internal/analysis/scheduler_test.go`
- Modify: `internal/workspace/workspace.go`
- Modify: `internal/rpc/handlers.go`

- [ ] **Step 1: Write scheduler tests**

Create `internal/analysis/scheduler_test.go`:

```go
package analysis

import (
	"context"
	"testing"
	"time"

	"jcgo/internal/katago"
)

type fakeAnalyzer struct {
	calls []string
}

func (f *fakeAnalyzer) Analyze(ctx context.Context, query katago.Query) (katago.Result, error) {
	f.calls = append(f.calls, query.ID)
	return katago.Result{
		ID: query.ID,
		RootInfo: katago.RootInfo{Visits: 500, Winrate: 0.5, ScoreLead: 0},
		MoveInfos: []katago.MoveInfo{{Move: "Q16", Order: 0, Visits: 500, Winrate: 0.5, ScoreLead: 0}},
	}, nil
}

func (f *fakeAnalyzer) Available() bool { return true }
func (f *fakeAnalyzer) Status() katago.Status { return katago.Status{Available: true} }
func (f *fakeAnalyzer) Close() error { return nil }

func TestSchedulerStopsPendingTasks(t *testing.T) {
	engine := &fakeAnalyzer{}
	scheduler := NewScheduler(engine, 500)
	defer scheduler.Close()
	received := make(chan Event, 4)
	scheduler.Subscribe(func(event Event) { received <- event })

	scheduler.StartGame(StartInput{Token: "secret", GameID: "game-1", FocusNodeID: "main:0", Nodes: []NodeInput{
		{NodeID: "main:0", MoveNumber: 0, ToPlay: "B"},
		{NodeID: "main:1", MoveNumber: 1, ToPlay: "W"},
	}})
	scheduler.StopGame("secret", "game-1")

	select {
	case <-received:
	case <-time.After(time.Second):
		t.Fatal("expected at least one event")
	}
	if len(engine.calls) > 2 {
		t.Fatalf("too many calls after stop: %v", engine.calls)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
go test .\internal\analysis -run TestScheduler -count=1
```

Expected: FAIL because `NewScheduler` is undefined.

- [ ] **Step 3: Implement scheduler types**

Create `internal/analysis/scheduler.go` with:

```go
package analysis

import (
	"context"
	"sync"

	"jcgo/internal/domain"
	"jcgo/internal/katago"
)

type NodeInput struct {
	NodeID string
	MoveNumber int
	ToPlay domain.Color
}

type StartInput struct {
	Token string
	GameID string
	FocusNodeID string
	Nodes []NodeInput
}

type Event struct {
	Token string `json:"-"`
	GameID string `json:"gameId"`
	NodeID string `json:"nodeId"`
	MoveNumber int `json:"moveNumber"`
	Analysis domain.AnalysisResult `json:"analysis"`
}

type Subscriber func(Event)

type Scheduler struct {
	engine katago.Analyzer
	maxVisits int
	mu sync.Mutex
	queue []task
	stopped map[string]bool
	subscribers []Subscriber
	wake chan struct{}
	closed chan struct{}
}
```

Implement `NewScheduler`, `Subscribe`, `StartGame`, `AnalyzeNow`, `StopGame`, `RestartGame`, `Close`, and a single worker goroutine. Use key `token + "\x00" + gameID` for stop state. When a result arrives, normalize it with `Normalize(node.ToPlay, result)` and call subscribers.

- [ ] **Step 4: Store analysis in workspace**

Modify `internal/workspace/workspace.go` to add:

```go
func (w *Workspace) SetAnalysis(gameID string, nodeID string, result domain.AnalysisResult)
func (w *Workspace) ClearAnalysisAndVariations(gameID string, fallbackNodeID string) (domain.Snapshot, error)
func (w *Workspace) MainlineAnalysisInputs(gameID string) []analysis.NodeInput
```

The implementation stores analysis by `gameID + ":" + nodeID` and clears entries for a game on restart or variation deletion.

- [ ] **Step 5: Wire analysis methods in RPC**

Modify `internal/rpc/handlers.go` so:

- `analysis.start` calls scheduler `StartGame`.
- `analysis.stop` calls scheduler `StopGame`.
- `analysis.restart` clears workspace analysis/variations and calls scheduler `StartGame`.
- Scheduler events are emitted to connected clients as JSON-RPC notifications named `analysis.node`.

- [ ] **Step 6: Verify scheduler tests pass**

Run:

```powershell
go test .\internal\analysis .\internal\workspace .\internal\rpc -count=1
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add internal/analysis internal/workspace internal/rpc
git commit -m "feat: add analysis scheduler"
```

### Task 12: Compose the Backend Service

**Files:**
- Modify: `cmd/jcgo/main.go`
- Modify: `internal/httpserver/server.go`
- Create: `internal/app/app.go`
- Create: `internal/app/app_test.go`

- [ ] **Step 1: Write app composition test**

Create `internal/app/app_test.go`:

```go
package app

import (
	"context"
	"path/filepath"
	"testing"

	"jcgo/internal/config"
)

func TestNewAppStartsWithUnavailableEngineWhenPathsMissing(t *testing.T) {
	cfg := config.Config{
		AccessToken: "secret",
		DataDir: t.TempDir(),
		DatabasePath: filepath.Join(t.TempDir(), "jcgo.sqlite"),
		GamesDir: filepath.Join(t.TempDir(), "games"),
		MaxVisits: 500,
	}
	app, err := New(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	if app.EngineStatus().Available {
		t.Fatal("engine should be unavailable without configured paths")
	}
}
```

- [ ] **Step 2: Implement app composition**

Create `internal/app/app.go`:

```go
package app

import (
	"context"
	"errors"

	"jcgo/internal/analysis"
	"jcgo/internal/config"
	"jcgo/internal/katago"
	"jcgo/internal/rpc"
	"jcgo/internal/storage"
	"jcgo/internal/workspace"
)

type App struct {
	Repo *storage.Repository
	Files storage.FileStore
	Workspaces *workspace.Store
	Engine katago.Analyzer
	Scheduler *analysis.Scheduler
	RPC *rpc.Handler
}

func New(ctx context.Context, cfg config.Config) (*App, error) {
	repo, err := storage.Open(ctx, cfg.DatabasePath)
	if err != nil {
		return nil, err
	}
	files := storage.NewFileStore(cfg.GamesDir)
	engine, err := startEngine(ctx, cfg)
	if err != nil {
		engine = katago.NewUnavailable(err.Error())
	}
	workspaces := workspace.NewStore()
	scheduler := analysis.NewScheduler(engine, cfg.MaxVisits)
	handler := rpc.New(repo, files, workspaces, scheduler)
	return &App{Repo: repo, Files: files, Workspaces: workspaces, Engine: engine, Scheduler: scheduler, RPC: handler}, nil
}

func (a *App) EngineStatus() katago.Status {
	return a.Engine.Status()
}

func (a *App) Close() error {
	a.Scheduler.Close()
	_ = a.Engine.Close()
	return a.Repo.Close()
}

func startEngine(ctx context.Context, cfg config.Config) (katago.Analyzer, error) {
	if cfg.KatagoPath == "" || cfg.ModelPath == "" || cfg.AnalysisConfigPath == "" {
		return nil, errors.New("katago path, model path, and analysis config path are required for analysis")
	}
	return katago.StartLocal(ctx, cfg.KatagoPath, cfg.ModelPath, cfg.AnalysisConfigPath)
}
```

- [ ] **Step 3: Serve frontend static assets with SPA fallback**

Modify `internal/httpserver/server.go` so `Config.StaticDir` is used when present:

```go
func (s *Server) serveStatic(w http.ResponseWriter, r *http.Request) {
	if s.cfg.StaticDir == "" {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("JCGO"))
		return
	}
	path := filepath.Join(s.cfg.StaticDir, filepath.Clean(r.URL.Path))
	if info, err := os.Stat(path); err == nil && !info.IsDir() {
		http.ServeFile(w, r, path)
		return
	}
	http.ServeFile(w, r, filepath.Join(s.cfg.StaticDir, "index.html"))
}
```

- [ ] **Step 4: Wire `main` to app and server**

Modify `cmd/jcgo/main.go`:

```go
package main

import (
	"context"
	"log"
	"net/http"

	"jcgo/internal/app"
	"jcgo/internal/config"
	"jcgo/internal/httpserver"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	if err := config.EnsureDirs(cfg); err != nil {
		log.Fatal(err)
	}
	application, err := app.New(context.Background(), cfg)
	if err != nil {
		log.Fatal(err)
	}
	defer application.Close()

	server := httpserver.New(httpserver.Config{
		AccessToken: cfg.AccessToken,
		StaticDir:   "web/dist",
	}, application.RPC)
	log.Printf("jcgo listening on %s", cfg.ListenAddr)
	log.Fatal(http.ListenAndServe(cfg.ListenAddr, server.Handler()))
}
```

- [ ] **Step 5: Verify backend tests pass**

Run:

```powershell
go test .\internal\... .\cmd\jcgo -count=1
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add cmd internal/app internal/httpserver
git commit -m "feat: compose backend service"
```

### Task 13: Frontend JSON-RPC Client, Types, and Token Gate

**Files:**
- Create: `web/src/api/types.ts`
- Create: `web/src/api/jsonrpc.ts`
- Create: `web/src/api/jsonrpc.test.ts`
- Create: `web/src/state/appStore.ts`
- Create: `web/src/components/TokenGate.tsx`
- Create: `web/src/components/TokenGate.test.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Write JSON-RPC client tests**

Create `web/src/api/jsonrpc.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildProtocols, makeRequest } from './jsonrpc'

describe('jsonrpc helpers', () => {
  it('builds websocket subprotocols with token', () => {
    expect(buildProtocols('secret')).toEqual(['jcgo-jsonrpc', 'token.secret'])
  })

  it('creates JSON-RPC 2.0 requests', () => {
    expect(makeRequest('1', 'game.list', {})).toEqual({
      jsonrpc: '2.0',
      id: '1',
      method: 'game.list',
      params: {},
    })
  })
})
```

- [ ] **Step 2: Implement shared frontend types**

Create `web/src/api/types.ts`:

```ts
export type Color = 'B' | 'W'

export interface GameRecord {
  gameId: string
  displayName: string
  result: string
  sgfFilename: string
  createdAt: string
}

export interface Stone {
  x: number
  y: number
  color: Color
}

export interface MoveView {
  nodeId: string
  moveNumber: number
  color: Color
  gtp: string
  pass: boolean
}

export interface Snapshot {
  gameId: string
  nodeId: string
  moveNumber: number
  totalMoves: number
  branchMode: 'main' | 'variation'
  stones: Stone[]
  lastMove?: MoveView
  toPlay: Color
  rules: string
  komi: number
  captures: Record<Color, number>
  gameEnded: boolean
  canPrevious: boolean
  canNext: boolean
  canBackToMain: boolean
  analysis?: AnalysisResult
}

export interface CandidateMove {
  move: string
  order: number
  visits: number
  winrate: number
  scoreLead: number
  pointLoss: number
  relativePointLoss: number
  winrateLoss: number
  pv: string[]
  lowVisits: boolean
}

export interface AnalysisResult {
  winrate: number
  scoreLead: number
  visits: number
  candidates: CandidateMove[]
}
```

- [ ] **Step 3: Implement JSON-RPC client helpers**

Create `web/src/api/jsonrpc.ts`:

```ts
export interface JSONRPCRequest {
  jsonrpc: '2.0'
  id: string
  method: string
  params?: unknown
}

export function buildProtocols(token: string): string[] {
  return ['jcgo-jsonrpc', `token.${token}`]
}

export function makeRequest(id: string, method: string, params?: unknown): JSONRPCRequest {
  return { jsonrpc: '2.0', id, method, params }
}

export class RPCClient {
  private ws?: WebSocket
  private seq = 0
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>()

  connect(url: string, token: string) {
    this.ws = new WebSocket(url, buildProtocols(token))
    this.ws.onmessage = (event) => this.handleMessage(event.data)
  }

  call<T>(method: string, params?: unknown): Promise<T> {
    const id = String(++this.seq)
    const request = makeRequest(id, method, params)
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      this.ws?.send(JSON.stringify(request))
    })
  }

  private handleMessage(raw: string) {
    const message = JSON.parse(raw)
    if (!message.id) return
    const pending = this.pending.get(String(message.id))
    if (!pending) return
    this.pending.delete(String(message.id))
    if (message.error) pending.reject(message.error)
    else pending.resolve(message.result)
  }
}
```

- [ ] **Step 4: Create token gate**

Create `web/src/components/TokenGate.tsx`:

```tsx
import { FormEvent, useState } from 'react'

interface TokenGateProps {
  onSubmit(token: string): void
}

export function TokenGate({ onSubmit }: TokenGateProps) {
  const [token, setToken] = useState(localStorage.getItem('jcgo.accessToken') ?? '')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = token.trim()
    if (!trimmed) return
    localStorage.setItem('jcgo.accessToken', trimmed)
    onSubmit(trimmed)
  }
  return (
    <main className="token-gate">
      <form onSubmit={submit}>
        <h1>JCGO</h1>
        <label>
          Access token
          <input value={token} onChange={(event) => setToken(event.target.value)} autoFocus />
        </label>
        <button type="submit">Connect</button>
      </form>
    </main>
  )
}
```

- [ ] **Step 5: Wire App to token gate**

Replace `web/src/App.tsx`:

```tsx
import { useState } from 'react'
import { TokenGate } from './components/TokenGate'
import './styles.css'

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('jcgo.accessToken'))
  if (!token) return <TokenGate onSubmit={setToken} />
  return <main className="app-layout">JCGO workspace connected</main>
}
```

- [ ] **Step 6: Verify frontend tests pass**

Run:

```powershell
cd web
npm test -- --run
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add web/src/api web/src/state web/src/components web/src/App.tsx
git commit -m "feat: add frontend rpc token gate"
```

### Task 14: Game Sidebar, Import, Rename, and Delete UI

**Files:**
- Create: `web/src/components/GameSidebar.tsx`
- Create: `web/src/components/GameSidebar.test.tsx`
- Create: `web/src/components/ImportDialog.tsx`
- Modify: `web/src/state/appStore.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/styles.css`

- [ ] **Step 1: Write sidebar tests**

Create `web/src/components/GameSidebar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GameSidebar } from './GameSidebar'

describe('GameSidebar', () => {
  it('renders imported games newest first', () => {
    render(
      <GameSidebar
        games={[
          { gameId: '2', displayName: 'New', result: 'W+R', sgfFilename: '2.sgf', createdAt: '2026-06-24T02:00:00Z' },
          { gameId: '1', displayName: 'Old', result: 'B+R', sgfFilename: '1.sgf', createdAt: '2026-06-24T01:00:00Z' },
        ]}
        selectedGameId="2"
        onImport={vi.fn()}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByText('New')).toBeInTheDocument()
    expect(screen.getByText('Old')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Implement sidebar**

Create `web/src/components/GameSidebar.tsx`:

```tsx
import { GameRecord } from '../api/types'
import { Plus, Trash2 } from 'lucide-react'

interface GameSidebarProps {
  games: GameRecord[]
  selectedGameId?: string
  onImport(): void
  onSelect(gameId: string): void
  onRename(gameId: string, displayName: string): void
  onDelete(gameId: string): void
}

export function GameSidebar({ games, selectedGameId, onImport, onSelect, onRename, onDelete }: GameSidebarProps) {
  return (
    <aside className="game-sidebar">
      <button className="icon-button" onClick={onImport} aria-label="Import SGF">
        <Plus size={18} />
      </button>
      <div className="game-list">
        {games.map((game) => (
          <div className={game.gameId === selectedGameId ? 'game-row selected' : 'game-row'} key={game.gameId}>
            <button className="game-title" onClick={() => onSelect(game.gameId)}>
              <span>{game.displayName}</span>
              <small>{game.result || 'Unknown result'}</small>
            </button>
            <button
              className="icon-button"
              aria-label={`Rename ${game.displayName}`}
              onClick={() => {
                const name = window.prompt('Rename game', game.displayName)
                if (name && name.trim()) onRename(game.gameId, name.trim())
              }}
            >
              A
            </button>
            <button
              className="icon-button"
              aria-label={`Delete ${game.displayName}`}
              onClick={() => {
                if (window.confirm(`Delete ${game.displayName}?`)) onDelete(game.gameId)
              }}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </aside>
  )
}
```

- [ ] **Step 3: Implement import dialog**

Create `web/src/components/ImportDialog.tsx`:

```tsx
import { ChangeEvent, useRef } from 'react'

interface ImportDialogProps {
  onImport(displayName: string, originalFilename: string, sgfText: string): void
}

export function ImportDialog({ onImport }: ImportDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const choose = () => inputRef.current?.click()
  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const defaultName = file.name.replace(/\.sgf$/i, '')
    const displayName = window.prompt('Game name', defaultName)?.trim()
    if (!displayName) return
    const sgfText = await file.text()
    onImport(displayName, file.name, sgfText)
  }
  return (
    <>
      <button onClick={choose}>Import</button>
      <input ref={inputRef} type="file" accept=".sgf" hidden onChange={onFile} />
    </>
  )
}
```

- [ ] **Step 4: Wire App methods to RPC client**

Modify `web/src/App.tsx` to maintain `games`, `selectedGameId`, and `snapshot` state. Call:

```ts
client.call<{ games: GameRecord[] }>('game.list')
client.call('game.importSgf', { displayName, originalFilename, sgfText })
client.call('game.rename', { gameId, displayName })
client.call('game.delete', { gameId })
client.call('game.select', { gameId })
```

After `game.importSgf`, set the returned game as selected and render the returned snapshot.

- [ ] **Step 5: Verify frontend tests pass**

Run:

```powershell
cd web
npm test -- --run
npm run build
```

Expected: both commands pass.

- [ ] **Step 6: Commit**

```powershell
git add web/src/components web/src/state web/src/App.tsx web/src/styles.css
git commit -m "feat: add game library ui"
```

### Task 15: Board, Navigation, PV Animation, and Branch Controls

**Files:**
- Create: `web/src/components/Board.tsx`
- Create: `web/src/components/Board.test.tsx`
- Create: `web/src/components/NavigationControls.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/styles.css`

- [ ] **Step 1: Write board rendering test**

Create `web/src/components/Board.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Board } from './Board'

describe('Board', () => {
  it('renders stones and candidate labels', () => {
    render(
      <Board
        snapshot={{
          gameId: 'g',
          nodeId: 'main:1',
          moveNumber: 1,
          totalMoves: 1,
          branchMode: 'main',
          stones: [{ x: 15, y: 3, color: 'B' }],
          toPlay: 'W',
          rules: 'chinese',
          komi: 7.5,
          captures: { B: 0, W: 0 },
          gameEnded: false,
          canPrevious: true,
          canNext: false,
          canBackToMain: false,
          analysis: {
            winrate: 0.5,
            scoreLead: 0,
            visits: 500,
            candidates: [{ move: 'D16', order: 0, visits: 500, winrate: 0.5, scoreLead: 0, pointLoss: 0, relativePointLoss: 0, winrateLoss: 0, pv: ['D16'], lowVisits: false }],
          },
        }}
        onPlay={vi.fn()}
        onPreviewPV={vi.fn()}
        onClearPV={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Go board')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Implement SVG board**

Create `web/src/components/Board.tsx`:

```tsx
import { CandidateMove, Snapshot } from '../api/types'

interface BoardProps {
  snapshot?: Snapshot
  activePV?: string[]
  onPlay(gtp: string): void
  onPreviewPV(candidate: CandidateMove): void
  onClearPV(): void
}

const size = 19
const pad = 28
const gap = 28
const boardSize = pad * 2 + gap * (size - 1)

export function Board({ snapshot, activePV, onPlay, onPreviewPV, onClearPV }: BoardProps) {
  const stones = snapshot?.stones ?? []
  const candidates = snapshot?.analysis?.candidates ?? []
  return (
    <svg className="go-board" viewBox={`0 0 ${boardSize} ${boardSize}`} role="img" aria-label="Go board" onMouseLeave={onClearPV}>
      <rect x="0" y="0" width={boardSize} height={boardSize} rx="6" fill="#d8a95f" />
      {Array.from({ length: size }, (_, i) => (
        <g key={i}>
          <line x1={pad} y1={pad + i * gap} x2={boardSize - pad} y2={pad + i * gap} stroke="#2f2419" strokeWidth="1" />
          <line x1={pad + i * gap} y1={pad} x2={pad + i * gap} y2={boardSize - pad} stroke="#2f2419" strokeWidth="1" />
        </g>
      ))}
      {stones.map((stone) => (
        <circle
          key={`${stone.x}-${stone.y}`}
          cx={pad + stone.x * gap}
          cy={pad + stone.y * gap}
          r={gap * 0.43}
          fill={stone.color === 'B' ? '#111' : '#f5f2ea'}
          stroke="#111"
        />
      ))}
      {candidates.map((candidate) => {
        const point = gtpToPoint(candidate.move)
        if (!point) return null
        return (
          <g
            key={candidate.move}
            onMouseEnter={() => onPreviewPV(candidate)}
            onClick={() => onPlay(candidate.move)}
            opacity={candidate.lowVisits ? 0.45 : 1}
          >
            <circle cx={pad + point.x * gap} cy={pad + point.y * gap} r={gap * 0.34} fill={candidate.order === 0 ? '#4f8a5b' : '#e8c85c'} />
            {!candidate.lowVisits && <text x={pad + point.x * gap} y={pad + point.y * gap + 4} textAnchor="middle" fontSize="9">{formatCandidate(candidate)}</text>}
          </g>
        )
      })}
      {(activePV ?? []).map((move, index) => {
        const point = gtpToPoint(move)
        if (!point) return null
        return (
          <g key={`${move}-${index}`}>
            <circle cx={pad + point.x * gap} cy={pad + point.y * gap} r={gap * 0.38} fill={index % 2 === 0 ? '#111' : '#f5f2ea'} stroke="#111" />
            <text x={pad + point.x * gap} y={pad + point.y * gap + 5} textAnchor="middle" fontSize="14" fill={index % 2 === 0 ? '#fff' : '#111'}>{index + 1}</text>
          </g>
        )
      })}
    </svg>
  )
}

function formatCandidate(candidate: CandidateMove) {
  return `${candidate.pointLoss.toFixed(1)}\n${candidate.visits}`
}

function gtpToPoint(gtp: string): { x: number; y: number } | null {
  if (gtp.toLowerCase() === 'pass') return null
  const letters = 'ABCDEFGHJKLMNOPQRST'
  const x = letters.indexOf(gtp[0]?.toUpperCase())
  const row = Number(gtp.slice(1))
  if (x < 0 || !row) return null
  return { x, y: 19 - row }
}
```

- [ ] **Step 3: Implement navigation controls**

Create `web/src/components/NavigationControls.tsx`:

```tsx
import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, RotateCcw } from 'lucide-react'

interface NavigationControlsProps {
  moveNumber: number
  totalMoves: number
  canBackToMain: boolean
  onFirst(): void
  onPrevious(): void
  onNext(): void
  onLast(): void
  onBackToMain(): void
  onPass(): void
  onDeleteVariationNode(): void
  onClearVariation(): void
}

export function NavigationControls(props: NavigationControlsProps) {
  return (
    <nav className="navigation-controls">
      <button aria-label="First move" onClick={props.onFirst}><ChevronsLeft size={18} /></button>
      <button aria-label="Previous move" onClick={props.onPrevious}><ChevronLeft size={18} /></button>
      <span>{props.moveNumber} / {props.totalMoves}</span>
      <button aria-label="Next move" onClick={props.onNext}><ChevronRight size={18} /></button>
      <button aria-label="Last move" onClick={props.onLast}><ChevronsRight size={18} /></button>
      {props.canBackToMain && <button aria-label="Back to main line" onClick={props.onBackToMain}><RotateCcw size={18} /></button>}
      <button onClick={props.onPass}>Pass</button>
      <button onClick={props.onDeleteVariationNode}>Delete node</button>
      <button onClick={props.onClearVariation}>Clear branch</button>
    </nav>
  )
}
```

- [ ] **Step 4: Wire RPC calls and keyboard shortcuts**

In `web/src/App.tsx`, wire board/navigation to:

```ts
client.call('game.goto', { gameId, moveNumber })
client.call('game.play', { gameId, move: gtp })
client.call('game.pass', { gameId })
client.call('game.backToMain', { gameId })
client.call('game.deleteVariationNode', { gameId })
client.call('game.clearVariation', { gameId })
```

Add `keydown` listener:

```ts
if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
if (event.key === 'ArrowLeft') goPrevious()
if (event.key === 'ArrowRight') goNext()
if (event.key === 'Escape') clearPVOrBackToMainOrCloseLayer()
```

- [ ] **Step 5: Verify board tests and build pass**

Run:

```powershell
cd web
npm test -- --run
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add web/src/components web/src/App.tsx web/src/styles.css
git commit -m "feat: add board navigation variations"
```

### Task 16: Analysis Panel, Charts, Bad Move List, and Engine Status

**Files:**
- Create: `web/src/components/AnalysisPanel.tsx`
- Create: `web/src/components/AnalysisCharts.tsx`
- Create: `web/src/components/BadMoveList.tsx`
- Create: `web/src/components/AnalysisPanel.test.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/styles.css`

- [ ] **Step 1: Write analysis panel test**

Create `web/src/components/AnalysisPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnalysisPanel } from './AnalysisPanel'

describe('AnalysisPanel', () => {
  it('shows black winrate score lead and candidates', () => {
    render(
      <AnalysisPanel
        engineStatus={{ available: true }}
        analysis={{
          winrate: 0.625,
          scoreLead: 4.2,
          visits: 500,
          candidates: [{ move: 'Q16', order: 0, visits: 400, winrate: 0.63, scoreLead: 4.4, pointLoss: 0, relativePointLoss: 0, winrateLoss: 0, pv: ['Q16'], lowVisits: false }],
        }}
        analysisState="idle"
        onStart={vi.fn()}
        onStop={vi.fn()}
        onRestart={vi.fn()}
        onCandidateClick={vi.fn()}
      />,
    )
    expect(screen.getByText('62.5%')).toBeInTheDocument()
    expect(screen.getByText('B +4.2')).toBeInTheDocument()
    expect(screen.getByText('Q16')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Implement analysis panel**

Create `web/src/components/AnalysisPanel.tsx`:

```tsx
import { AnalysisResult, CandidateMove } from '../api/types'

interface EngineStatus {
  available: boolean
  error?: string
}

interface AnalysisPanelProps {
  engineStatus: EngineStatus
  analysis?: AnalysisResult
  analysisState: 'idle' | 'running' | 'stopped' | 'complete' | 'unavailable'
  onStart(): void
  onStop(): void
  onRestart(): void
  onCandidateClick(move: string): void
}

export function AnalysisPanel({ engineStatus, analysis, analysisState, onStart, onStop, onRestart, onCandidateClick }: AnalysisPanelProps) {
  const action = analysisState === 'running'
    ? <button onClick={onStop}>Stop analysis</button>
    : analysisState === 'complete'
      ? <button onClick={onRestart}>Re-analyze</button>
      : <button onClick={onStart} disabled={!engineStatus.available}>Start analysis</button>
  return (
    <aside className="analysis-panel">
      {!engineStatus.available && <div className="engine-error">Engine unavailable: {engineStatus.error}</div>}
      <div className="analysis-summary">
        <strong>{analysis ? `${(analysis.winrate * 100).toFixed(1)}%` : '-'}</strong>
        <strong>{analysis ? formatScore(analysis.scoreLead) : '-'}</strong>
        <span>{analysis?.visits ?? 0} visits</span>
        {action}
      </div>
      <div className="candidate-list">
        {(analysis?.candidates ?? []).map((candidate) => (
          <CandidateRow key={candidate.move} candidate={candidate} onClick={() => onCandidateClick(candidate.move)} />
        ))}
      </div>
    </aside>
  )
}

function CandidateRow({ candidate, onClick }: { candidate: CandidateMove; onClick(): void }) {
  return (
    <button className={candidate.lowVisits ? 'candidate-row low-visits' : 'candidate-row'} onClick={onClick}>
      <span>{candidate.move}</span>
      <span>{candidate.visits}</span>
      <span>{(candidate.winrate * 100).toFixed(1)}%</span>
      <span>{formatScore(candidate.scoreLead)}</span>
      <span>{candidate.pointLoss.toFixed(1)}</span>
    </button>
  )
}

function formatScore(scoreLead: number) {
  return scoreLead >= 0 ? `B +${scoreLead.toFixed(1)}` : `W +${Math.abs(scoreLead).toFixed(1)}`
}
```

- [ ] **Step 3: Implement charts**

Create `web/src/components/AnalysisCharts.tsx`:

```tsx
import ReactECharts from 'echarts-for-react'

interface ChartPoint {
  moveNumber: number
  winrate: number
  scoreLead: number
}

interface AnalysisChartsProps {
  points: ChartPoint[]
  onJump(moveNumber: number): void
}

export function AnalysisCharts({ points, onJump }: AnalysisChartsProps) {
  const option = {
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: points.map((p) => p.moveNumber) },
    yAxis: [
      { type: 'value', min: 0, max: 100 },
      { type: 'value' },
    ],
    series: [
      { name: 'Black winrate', type: 'line', data: points.map((p) => Math.round(p.winrate * 1000) / 10), yAxisIndex: 0 },
      { name: 'Score lead', type: 'line', data: points.map((p) => p.scoreLead), yAxisIndex: 1 },
    ],
  }
  return <ReactECharts option={option} onEvents={{ click: (params: { dataIndex: number }) => onJump(points[params.dataIndex].moveNumber) }} />
}
```

- [ ] **Step 4: Implement bad move list**

Create `web/src/components/BadMoveList.tsx`:

```tsx
interface BadMove {
  nodeId: string
  moveNumber: number
  move: string
  pointLoss: number
  class: number
}

interface BadMoveListProps {
  badMoves: BadMove[]
  onJump(moveNumber: number): void
}

export function BadMoveList({ badMoves, onJump }: BadMoveListProps) {
  return (
    <section className="bad-move-list">
      {badMoves.map((move) => (
        <button key={move.nodeId} className={`bad-move class-${move.class}`} onClick={() => onJump(move.moveNumber)}>
          <span>{move.moveNumber}</span>
          <span>{move.move}</span>
          <span>{move.pointLoss.toFixed(1)}</span>
        </button>
      ))}
    </section>
  )
}
```

- [ ] **Step 5: Wire analysis notifications**

Modify `web/src/api/jsonrpc.ts` to support notification listeners:

```ts
type NotificationHandler = (params: unknown) => void
private notifications = new Map<string, NotificationHandler[]>()

on(method: string, handler: NotificationHandler) {
  const list = this.notifications.get(method) ?? []
  list.push(handler)
  this.notifications.set(method, list)
}
```

In `handleMessage`, when `message.method` exists and `message.id` is absent, call registered handlers. In `App.tsx`, handle `analysis.node` by updating a map keyed by `nodeId`, rebuilding chart points and bad move list.

- [ ] **Step 6: Verify frontend analysis tests pass**

Run:

```powershell
cd web
npm test -- --run
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add web/src/components web/src/api web/src/App.tsx web/src/styles.css
git commit -m "feat: add analysis panels"
```

### Task 17: Responsive Layout and Basic PWA Shell

**Files:**
- Create: `web/src/components/RotatePrompt.tsx`
- Create: `web/src/pwa/registerServiceWorker.ts`
- Create: `web/public/manifest.webmanifest`
- Create: `web/public/sw.js`
- Modify: `web/src/main.tsx`
- Modify: `web/src/styles.css`
- Modify: `web/index.html`

- [ ] **Step 1: Add mobile rotation prompt component**

Create `web/src/components/RotatePrompt.tsx`:

```tsx
export function RotatePrompt() {
  return (
    <div className="rotate-prompt">
      <h1>Rotate device</h1>
      <p>JCGO review mode uses a horizontal board workspace.</p>
    </div>
  )
}
```

- [ ] **Step 2: Add responsive CSS**

Append to `web/src/styles.css`:

```css
.app-layout {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(56px, 260px) minmax(420px, 1fr) minmax(320px, 420px);
  gap: 12px;
}

.go-board {
  width: min(76vh, 100%);
  max-height: 92vh;
}

.navigation-controls {
  display: flex;
  gap: 6px;
  align-items: center;
}

.rotate-prompt {
  display: none;
}

@media (orientation: portrait) and (max-width: 820px) {
  .app-layout {
    display: none;
  }
  .rotate-prompt {
    min-height: 100vh;
    display: grid;
    place-items: center;
    text-align: center;
  }
}

@media (orientation: landscape) and (max-height: 520px) {
  .app-layout {
    grid-template-columns: 64px minmax(360px, 1fr) 56px minmax(260px, 340px);
  }
  .navigation-controls {
    flex-direction: column;
  }
}
```

- [ ] **Step 3: Add manifest and service worker**

Create `web/public/manifest.webmanifest`:

```json
{
  "name": "JCGO",
  "short_name": "JCGO",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#f5f1e8",
  "theme_color": "#2f5d50",
  "icons": []
}
```

Create `web/public/sw.js`:

```js
const CACHE_NAME = 'jcgo-static-v1'
const STATIC_ASSETS = ['/', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)))
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)))
})
```

Create `web/src/pwa/registerServiceWorker.ts`:

```ts
export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined)
    })
  }
}
```

- [ ] **Step 4: Register PWA shell**

Modify `web/index.html` to include:

```html
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="#2f5d50" />
```

Modify `web/src/main.tsx`:

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { registerServiceWorker } from './pwa/registerServiceWorker'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

registerServiceWorker()
```

- [ ] **Step 5: Verify PWA build**

Run:

```powershell
cd web
npm run build
```

Expected: `web/dist/manifest.webmanifest` and `web/dist/sw.js` exist.

- [ ] **Step 6: Commit**

```powershell
git add web/public web/src/pwa web/src/components/RotatePrompt.tsx web/src/main.tsx web/src/styles.css web/index.html
git commit -m "feat: add responsive pwa shell"
```

### Task 18: End-to-End Flow and Documentation

**Files:**
- Create: `e2e/jcgo.spec.ts`
- Create: `playwright.config.ts`
- Modify: `README.md`
- Modify: `web/package.json`

- [ ] **Step 1: Add Playwright config**

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4380',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-landscape', use: { viewport: { width: 932, height: 430 }, isMobile: true } },
  ],
})
```

- [ ] **Step 2: Add smoke e2e test**

Create `e2e/jcgo.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

test('loads token gate', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('JCGO')).toBeVisible()
  await expect(page.getByLabel('Access token')).toBeVisible()
})
```

- [ ] **Step 3: Add npm script**

Modify `web/package.json` scripts:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest",
    "preview": "vite preview"
  }
}
```

If the generated file already contains these keys, keep the generated values and add only missing keys.

- [ ] **Step 4: Update README with local and server usage**

Replace `README.md`:

```markdown
# JCGO

JCGO is a remote single-token Go + React PWA for SGF-based KataGo analysis review.

## Development

Backend tests:

```powershell
go test ./...
```

Frontend tests and build:

```powershell
cd web
npm test -- --run
npm run build
```

Run the server:

```powershell
$env:JCGO_ACCESS_TOKEN='dev-token'
$env:JCGO_DATA_DIR='.data'
$env:JCGO_KATAGO_PATH='D:\Code\katrain\.venv\Lib\site-packages\katrain\KataGo\katago.exe'
$env:JCGO_MODEL_PATH='D:\Code\katrain\.venv\Lib\site-packages\katrain\models\kata1-b18c384nbt-s9996604416-d4316597426.bin.gz'
$env:JCGO_ANALYSIS_CONFIG_PATH='D:\Code\katrain\.venv\Lib\site-packages\katrain\KataGo\analysis_config.cfg'
go run ./cmd/jcgo
```

Open `http://127.0.0.1:4380` and enter `dev-token`.
```

- [ ] **Step 5: Run full verification**

Run:

```powershell
go test ./...
```

Expected: PASS.

Run:

```powershell
cd web
npm test -- --run
npm run build
```

Expected: PASS.

Run:

```powershell
npx playwright test
```

Expected: PASS after the server is running with `JCGO_ACCESS_TOKEN`.

- [ ] **Step 6: Commit**

```powershell
git add README.md playwright.config.ts e2e web/package.json
git commit -m "test: add e2e smoke coverage"
```

## Final Verification Checklist

Before marking the plan complete, run these commands from `D:\Code\JCGO`:

```powershell
go test ./...
```

Expected: PASS.

```powershell
cd web
npm test -- --run
npm run build
```

Expected: PASS.

Start the server with the README environment variables, open `http://127.0.0.1:4380`, enter the token, import `testdata/sgf/simple-19.sgf`, and verify:

- The imported game appears at the top of the left list.
- The board opens at move `0 / 4`.
- `Start analysis` returns engine status if KataGo is unavailable and live analysis if configured.
- Arrow keys move through the mainline.
- Clicking a candidate or legal empty point enters variation mode.
- `Esc` clears PV first, then returns to mainline when in a variation.
- Reconnecting with the same token restores in-process workspace state.

## Plan Review Notes

- The plan intentionally implements v1 SGF parsing and rules support only: standard SGF, single game, 19x19, root setup stones, mainline only.
- The plan keeps front-end state derived from backend snapshots. The browser never becomes the rules authority.
- The plan treats KaTrain as behavior reference for analysis normalization, point-loss thresholds, candidate display, and PV animation, not as a code dependency.
- The plan avoids persisted analysis caches. SQLite remains a game index, while SGF source files live in the configured games directory.
