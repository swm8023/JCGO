# YuanluoBo Account Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a YuanluoBo account import flow where users scan-login with the YuanluoBo app, browse official categorized account games, and import or open individual games without duplicate local copies.

**Architecture:** Backend owns YuanluoBo auth, remote API calls, persisted credentials, source-based duplicate detection, and SGF import. Frontend renders the add-menu YuanluoBo workflow and calls JSON-RPC methods; it does not hold YuanluoBo tokens or reconstruct game data. Local games gain source metadata so YuanluoBo `session_id` can map to an existing JCGO `gameId`.

**Tech Stack:** Go, SQLite via `modernc.org/sqlite`, `net/http`, JSON-RPC over WebSocket, React 19, Vite, Vitest, Testing Library.

---

## File Structure

- Modify `internal/store/repository.go`: add source metadata columns, source lookup helpers, and source-aware create input.
- Modify `internal/store/store_test.go`: cover migration, create/list/get source fields, and source lookup.
- Create `internal/app/yuanluobo_auth.go`: file-backed and memory YuanluoBo auth stores.
- Create `internal/app/yuanluobo_auth_test.go`: cover auth save/load/clear behavior.
- Create `internal/app/yuanluobo_client.go`: typed YuanluoBo HTTP client, auth headers, API envelopes, auth invalid detection, category constants.
- Create `internal/app/yuanluobo_client_test.go`: cover QR login, polling, auth headers, record list parsing, and auth invalid responses.
- Create `internal/app/yuanluobo.go`: YuanluoBo service interface, status, player list, record list mapping, import result types.
- Create `internal/app/yuanluobo_handlers.go`: JSON-RPC handlers for `yuanluobo.*`.
- Modify `internal/app/handlers.go`: add handler options, YuanluoBo service field, `Call` dispatch, params, and shared SGF import helper.
- Modify `internal/app/app.go`: wire `.data/yuanluobo_auth.json` into the production handler.
- Modify `internal/app/sgf_import.go`: add context-aware YuanluoBo detail fetch support and reuse conversion for account imports.
- Modify `internal/app/handlers_test.go`: add RPC tests for records, imports, duplicate open, logout, and auth invalid cleanup.
- Modify `web/src/api/types.ts`: add YuanluoBo RPC result types.
- Create `web/src/components/YuanluoboImportDialog.tsx`: full YuanluoBo scan/login/list/import UI.
- Create `web/src/components/YuanluoboImportDialog.test.tsx`: cover scan login UI, categories, pagination, imported markers, import/open behavior.
- Modify `web/src/components/ImportDialog.tsx`: add “元萝卜” entry and route to `YuanluoBoImportDialog`.
- Modify `web/src/components/ImportDialog.test.tsx`: cover the new entry.
- Modify `web/src/App.tsx`: provide YuanluoBo API adapter and open imported games.
- Modify `web/src/styles.css`: add compact modal/list styles for the YuanluoBo import surface.

---

### Task 1: Add Local Game Source Metadata

**Files:**
- Modify: `internal/store/repository.go`
- Test: `internal/store/store_test.go`

- [ ] **Step 1: Write failing store tests**

Add these tests to `internal/store/store_test.go`:

```go
func TestRepositoryStoresAndFindsGameSource(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	repo, err := Open(ctx, filepath.Join(dir, "jcgo.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()

	game, err := repo.CreateGame(ctx, CreateGameInput{
		DisplayName:    "YuanluoBo",
		Result:         "B+R",
		GameDate:       "2026-07-08",
		SGFFilename:    "ylb.sgf",
		SourcePlatform: "yuanluobo",
		SourceID:       "session-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if game.SourcePlatform != "yuanluobo" || game.SourceID != "session-1" {
		t.Fatalf("created source = %q/%q", game.SourcePlatform, game.SourceID)
	}

	found, ok, err := repo.FindGameBySource(ctx, "yuanluobo", "session-1")
	if err != nil {
		t.Fatal(err)
	}
	if !ok || found.ID != game.ID {
		t.Fatalf("found = %#v, ok = %v", found, ok)
	}

	listed, err := repo.ListGames(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].SourceID != "session-1" {
		t.Fatalf("listed = %#v", listed)
	}
}

func TestRepositoryMigratesExistingGamesTableWithSourceColumns(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "jcgo.sqlite")
	db, err := sql.Open("sqlite", filepath.ToSlash(dbPath))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
		CREATE TABLE games (
			id TEXT PRIMARY KEY,
			display_name TEXT NOT NULL,
			result TEXT NOT NULL,
			game_date TEXT NOT NULL DEFAULT '',
			sgf_filename TEXT NOT NULL,
			created_at TEXT NOT NULL
		)
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO games (id, display_name, result, game_date, sgf_filename, created_at)
		VALUES ('old', 'Old', 'B+R', '2026-07-08', 'old.sgf', '2026-07-08T01:00:00Z')
	`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	repo, err := Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()

	old, err := repo.GetGame(ctx, "old")
	if err != nil {
		t.Fatal(err)
	}
	if old.SourcePlatform != "" || old.SourceID != "" {
		t.Fatalf("legacy source = %q/%q", old.SourcePlatform, old.SourceID)
	}
}
```

- [ ] **Step 2: Run failing store tests**

Run: `go test ./internal/store -run "TestRepositoryStoresAndFindsGameSource|TestRepositoryMigratesExistingGamesTableWithSourceColumns" -v`

Expected: FAIL because `SourcePlatform`, `SourceID`, and `FindGameBySource` do not exist.

- [ ] **Step 3: Implement source metadata in repository**

Update `GameRecord` and `CreateGameInput` in `internal/store/repository.go`:

```go
type GameRecord struct {
	ID             string    `json:"gameId"`
	DisplayName    string    `json:"displayName"`
	Result         string    `json:"result"`
	GameDate       string    `json:"gameDate,omitempty"`
	SGFFilename    string    `json:"sgfFilename"`
	CreatedAt      time.Time `json:"createdAt"`
	AnalysisStatus string    `json:"analysisStatus,omitempty"`
	SourcePlatform string    `json:"-"`
	SourceID       string    `json:"-"`
}

type CreateGameInput struct {
	DisplayName    string
	Result         string
	GameDate       string
	SGFFilename    string
	SourcePlatform string
	SourceID       string
}
```

Change `CreateGame` insert/select code to include `source_platform` and `source_id`:

```go
game := GameRecord{
	ID:             id,
	DisplayName:    input.DisplayName,
	Result:         input.Result,
	GameDate:       input.GameDate,
	SGFFilename:    sgfFilename,
	CreatedAt:      time.Now().UTC(),
	SourcePlatform: strings.TrimSpace(input.SourcePlatform),
	SourceID:       strings.TrimSpace(input.SourceID),
}
_, err = r.db.ExecContext(ctx, `
	INSERT INTO games (id, display_name, result, game_date, sgf_filename, created_at, source_platform, source_id)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`, game.ID, game.DisplayName, game.Result, game.GameDate, game.SGFFilename, formatTime(game.CreatedAt), game.SourcePlatform, game.SourceID)
```

Update `ListGames` and `GetGame` queries:

```sql
SELECT id, display_name, result, game_date, sgf_filename, created_at, source_platform, source_id
FROM games
```

Update `scanGame`:

```go
if err := scanner.Scan(
	&game.ID,
	&game.DisplayName,
	&game.Result,
	&game.GameDate,
	&game.SGFFilename,
	&createdAt,
	&game.SourcePlatform,
	&game.SourceID,
); err != nil {
	return GameRecord{}, err
}
```

Extend `migrate`:

```go
if err := r.ensureColumn(ctx, "game_date", "TEXT NOT NULL DEFAULT ''"); err != nil {
	return err
}
if err := r.ensureColumn(ctx, "source_platform", "TEXT NOT NULL DEFAULT ''"); err != nil {
	return err
}
if err := r.ensureColumn(ctx, "source_id", "TEXT NOT NULL DEFAULT ''"); err != nil {
	return err
}
_, err = r.db.ExecContext(ctx, `
	CREATE UNIQUE INDEX IF NOT EXISTS idx_games_source
	ON games(source_platform, source_id)
	WHERE source_platform <> '' AND source_id <> ''
`)
return err
```

Add source lookup:

```go
func (r *Repository) FindGameBySource(ctx context.Context, platform, sourceID string) (GameRecord, bool, error) {
	platform = strings.TrimSpace(platform)
	sourceID = strings.TrimSpace(sourceID)
	if platform == "" || sourceID == "" {
		return GameRecord{}, false, nil
	}
	row := r.db.QueryRowContext(ctx, `
		SELECT id, display_name, result, game_date, sgf_filename, created_at, source_platform, source_id
		FROM games
		WHERE source_platform = ? AND source_id = ?
	`, platform, sourceID)
	game, err := scanGame(row)
	if errors.Is(err, sql.ErrNoRows) {
		return GameRecord{}, false, nil
	}
	if err != nil {
		return GameRecord{}, false, err
	}
	return game, true, nil
}
```

- [ ] **Step 4: Run store tests**

Run: `go test ./internal/store -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add internal/store/repository.go internal/store/store_test.go
git commit -m "feat: track imported game sources"
```

---

### Task 2: Add YuanluoBo Auth Storage

**Files:**
- Create: `internal/app/yuanluobo_auth.go`
- Test: `internal/app/yuanluobo_auth_test.go`

- [ ] **Step 1: Write failing auth store tests**

Create `internal/app/yuanluobo_auth_test.go`:

```go
package app

import (
	"context"
	"path/filepath"
	"testing"
)

func TestYuanluoboFileAuthStoreSavesLoadsAndClears(t *testing.T) {
	ctx := context.Background()
	store := NewYuanluoboFileAuthStore(filepath.Join(t.TempDir(), "yuanluobo_auth.json"))

	if _, ok, err := store.Load(ctx); err != nil || ok {
		t.Fatalf("initial load auth = ok %v err %v", ok, err)
	}

	auth := YuanluoboAuth{Token: "token-1", UID: "uid-1"}
	if err := store.Save(ctx, auth); err != nil {
		t.Fatal(err)
	}
	loaded, ok, err := store.Load(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !ok || loaded.Token != "token-1" || loaded.UID != "uid-1" || loaded.UpdatedAt.IsZero() {
		t.Fatalf("loaded = %#v ok = %v", loaded, ok)
	}

	if err := store.Clear(ctx); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := store.Load(ctx); err != nil || ok {
		t.Fatalf("after clear auth = ok %v err %v", ok, err)
	}
}

func TestYuanluoboMemoryAuthStore(t *testing.T) {
	ctx := context.Background()
	store := NewYuanluoboMemoryAuthStore()
	if err := store.Save(ctx, YuanluoboAuth{Token: "token-2", UID: "uid-2"}); err != nil {
		t.Fatal(err)
	}
	loaded, ok, err := store.Load(ctx)
	if err != nil || !ok {
		t.Fatalf("loaded = %#v ok = %v err = %v", loaded, ok, err)
	}
	if loaded.Token != "token-2" || loaded.UID != "uid-2" {
		t.Fatalf("loaded = %#v", loaded)
	}
}
```

- [ ] **Step 2: Run failing auth tests**

Run: `go test ./internal/app -run TestYuanluobo.*AuthStore -v`

Expected: FAIL because auth store types do not exist.

- [ ] **Step 3: Implement auth stores**

Create `internal/app/yuanluobo_auth.go`:

```go
package app

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type YuanluoboAuth struct {
	Token     string    `json:"token"`
	UID       string    `json:"uid"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type YuanluoboAuthStore interface {
	Load(ctx context.Context) (YuanluoboAuth, bool, error)
	Save(ctx context.Context, auth YuanluoboAuth) error
	Clear(ctx context.Context) error
}

type YuanluoboFileAuthStore struct {
	path string
}

func NewYuanluoboFileAuthStore(path string) *YuanluoboFileAuthStore {
	return &YuanluoboFileAuthStore{path: path}
}

func (s *YuanluoboFileAuthStore) Load(context.Context) (YuanluoboAuth, bool, error) {
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return YuanluoboAuth{}, false, nil
	}
	if err != nil {
		return YuanluoboAuth{}, false, err
	}
	var auth YuanluoboAuth
	if err := json.Unmarshal(data, &auth); err != nil {
		return YuanluoboAuth{}, false, err
	}
	if auth.Token == "" || auth.UID == "" {
		return YuanluoboAuth{}, false, nil
	}
	return auth, true, nil
}

func (s *YuanluoboFileAuthStore) Save(_ context.Context, auth YuanluoboAuth) error {
	if auth.Token == "" || auth.UID == "" {
		return errors.New("yuanluobo auth token and uid are required")
	}
	auth.UpdatedAt = time.Now().UTC()
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(auth, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, data, 0o600)
}

func (s *YuanluoboFileAuthStore) Clear(context.Context) error {
	err := os.Remove(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

type YuanluoboMemoryAuthStore struct {
	mu   sync.Mutex
	auth YuanluoboAuth
	ok   bool
}

func NewYuanluoboMemoryAuthStore() *YuanluoboMemoryAuthStore {
	return &YuanluoboMemoryAuthStore{}
}

func (s *YuanluoboMemoryAuthStore) Load(context.Context) (YuanluoboAuth, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.auth, s.ok, nil
}

func (s *YuanluoboMemoryAuthStore) Save(_ context.Context, auth YuanluoboAuth) error {
	if auth.Token == "" || auth.UID == "" {
		return errors.New("yuanluobo auth token and uid are required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	auth.UpdatedAt = time.Now().UTC()
	s.auth = auth
	s.ok = true
	return nil
}

func (s *YuanluoboMemoryAuthStore) Clear(context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.auth = YuanluoboAuth{}
	s.ok = false
	return nil
}
```

- [ ] **Step 4: Run auth tests**

Run: `go test ./internal/app -run TestYuanluobo.*AuthStore -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add internal/app/yuanluobo_auth.go internal/app/yuanluobo_auth_test.go
git commit -m "feat: persist yuanluobo auth state"
```

---

### Task 3: Add YuanluoBo HTTP Client

**Files:**
- Create: `internal/app/yuanluobo_client.go`
- Test: `internal/app/yuanluobo_client_test.go`

- [ ] **Step 1: Write failing HTTP client tests**

Create `internal/app/yuanluobo_client_test.go`:

```go
package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestYuanluoboClientStartsAndPollsQRCodeLogin(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/sso/permit/v1/qrcode", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Fatalf("method = %s", r.Method)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code":    100000,
			"success": true,
			"data": map[string]any{
				"key":   "qr-key",
				"image": "base64-jpeg",
			},
		})
	})
	mux.HandleFunc("/sso/permit/v1/qrcode/poll", func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("key"); got != "qr-key" {
			t.Fatalf("key = %q", got)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code":    100000,
			"success": true,
			"data": map[string]any{
				"status": 2,
				"desc":   "已登录",
				"token":  "token-1",
				"uid":    "uid-1",
			},
		})
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	client := NewYuanluoboClient(server.URL, server.Client())
	qr, err := client.LoginStart(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if qr.Key != "qr-key" || qr.Image != "base64-jpeg" {
		t.Fatalf("qr = %#v", qr)
	}
	poll, err := client.LoginPoll(context.Background(), "qr-key")
	if err != nil {
		t.Fatal(err)
	}
	if poll.Status != YuanluoboQRLogined || poll.Token != "token-1" || poll.UID != "uid-1" {
		t.Fatalf("poll = %#v", poll)
	}
}

func TestYuanluoboClientSendsAuthHeadersForRecords(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/r2/chess/wq/sdr/v1/record/list", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("AUTH-TOKEN") != "token-1" || r.Header.Get("AUTH-USERID") != "uid-1" {
			t.Fatalf("auth headers = %q/%q", r.Header.Get("AUTH-TOKEN"), r.Header.Get("AUTH-USERID"))
		}
		if r.Header.Get("AUTH-PRODUCT-NAME") != "SenseRobot-Go" {
			t.Fatalf("product header = %q", r.Header.Get("AUTH-PRODUCT-NAME"))
		}
		var body YuanluoboRecordListRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Page != 1 || body.Size != 10 || body.PlayerID != "player-1" || body.GameMode != 15 {
			t.Fatalf("body = %#v", body)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code":    100000,
			"success": true,
			"data": map[string]any{
				"total":     1,
				"page":      1,
				"size":      10,
				"pageTotal": 1,
				"list": []map[string]any{{
					"session_id":        "session-1",
					"game_mode":         15,
					"game_rule":         1,
					"total_round":       120,
					"grid_size":         3,
					"play_mode":         1,
					"start_time":        1783500000,
					"black_player_name": "Black",
					"white_player_name": "White",
					"win_pieces":        -3.5,
				}},
			},
		})
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	client := NewYuanluoboClient(server.URL, server.Client())
	records, err := client.Records(context.Background(), YuanluoboAuth{Token: "token-1", UID: "uid-1"}, YuanluoboRecordListRequest{
		Page: 1, Size: 10, PlayerID: "player-1", GameMode: 15,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(records.List) != 1 || records.List[0].SessionID != "session-1" {
		t.Fatalf("records = %#v", records)
	}
}

func TestYuanluoboClientReturnsAuthInvalid(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code":    200401,
			"success": false,
			"message": "用户凭据丢失",
		})
	}))
	defer server.Close()

	client := NewYuanluoboClient(server.URL, server.Client())
	_, err := client.UserInfo(context.Background(), YuanluoboAuth{Token: "bad", UID: "uid"})
	if err == nil || !IsYuanluoboAuthInvalid(err) {
		t.Fatalf("err = %v", err)
	}
}
```

- [ ] **Step 2: Run failing client tests**

Run: `go test ./internal/app -run TestYuanluoboClient -v`

Expected: FAIL because client types do not exist.

- [ ] **Step 3: Implement YuanluoBo client**

Create `internal/app/yuanluobo_client.go` with these public types and constants:

```go
package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

const defaultYuanluoboBaseURL = "https://jupiter.yuanluobo.com"

type YuanluoboQRStatus int

const (
	YuanluoboQRUnscanned YuanluoboQRStatus = 0
	YuanluoboQRScanned   YuanluoboQRStatus = 1
	YuanluoboQRLogined   YuanluoboQRStatus = 2
	YuanluoboQROverdue   YuanluoboQRStatus = 3
	YuanluoboQRLoading   YuanluoboQRStatus = 4
)

type YuanluoboQRCode struct {
	Key   string `json:"key"`
	Image string `json:"image"`
}

type YuanluoboLoginPoll struct {
	Status YuanluoboQRStatus `json:"status"`
	Desc   string            `json:"desc"`
	Token  string            `json:"token"`
	UID    string            `json:"uid"`
}

type YuanluoboUser struct {
	ID          int64  `json:"id"`
	PlayerID    string `json:"playerId"`
	Name        string `json:"name"`
	GroupID     string `json:"groupId"`
	UserID      string `json:"userId"`
	AvatarURL   string `json:"avatarUrl"`
	PhoneNumber string `json:"phoneNumber"`
}

type YuanluoboPlayer struct {
	PlayerID  string `json:"playerId"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatarUrl"`
	GroupID   string `json:"groupId"`
}

type YuanluoboRecordListRequest struct {
	Page     int    `json:"page"`
	Size     int    `json:"size"`
	PlayerID string `json:"playerId"`
	GameMode int    `json:"gameMode"`
}

type YuanluoboRecordList struct {
	Total     int                      `json:"total"`
	Page      int                      `json:"page"`
	Size      int                      `json:"size"`
	PageTotal int                      `json:"pageTotal"`
	List      []YuanluoboRemoteRecord  `json:"list"`
}

type YuanluoboRemoteRecord struct {
	SessionID       string  `json:"session_id"`
	GameMode        int     `json:"game_mode"`
	GameRule        int     `json:"game_rule"`
	TotalRound      int     `json:"total_round"`
	GridSize        int     `json:"grid_size"`
	PlayMode        int     `json:"play_mode"`
	StartTime       int64   `json:"start_time"`
	BlackPlayerName string  `json:"black_player_name"`
	WhitePlayerName string  `json:"white_player_name"`
	RobotStrength   string  `json:"robot_strength_desc"`
	WinPieces       float64 `json:"win_pieces"`
}

type yuanluoboEnvelope[T any] struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Success bool   `json:"success"`
	Data    T      `json:"data"`
}

type YuanluoboAuthInvalidError struct {
	Message string
}

func (e YuanluoboAuthInvalidError) Error() string {
	if e.Message == "" {
		return "yuanluobo auth invalid"
	}
	return e.Message
}

func IsYuanluoboAuthInvalid(err error) bool {
	var target YuanluoboAuthInvalidError
	return errors.As(err, &target)
}
```

Add the client implementation:

```go
type YuanluoboClient struct {
	baseURL    string
	httpClient *http.Client
}

func NewYuanluoboClient(baseURL string, httpClient *http.Client) *YuanluoboClient {
	if strings.TrimSpace(baseURL) == "" {
		baseURL = defaultYuanluoboBaseURL
	}
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &YuanluoboClient{baseURL: strings.TrimRight(baseURL, "/"), httpClient: httpClient}
}

func (c *YuanluoboClient) LoginStart(ctx context.Context) (YuanluoboQRCode, error) {
	return getYuanluobo[YuanluoboQRCode](ctx, c, YuanluoboAuth{}, "/sso/permit/v1/qrcode", nil)
}

func (c *YuanluoboClient) LoginPoll(ctx context.Context, key string) (YuanluoboLoginPoll, error) {
	return getYuanluobo[YuanluoboLoginPoll](ctx, c, YuanluoboAuth{}, "/sso/permit/v1/qrcode/poll", url.Values{"key": {key}})
}

func (c *YuanluoboClient) UserInfo(ctx context.Context, auth YuanluoboAuth) (YuanluoboUser, error) {
	return postYuanluobo[YuanluoboUser](ctx, c, auth, "/r2/usercenter/v2/users/me/getOrAdd", map[string]any{})
}

func (c *YuanluoboClient) Players(ctx context.Context, auth YuanluoboAuth, groupID string) ([]YuanluoboPlayer, error) {
	var out struct {
		List []YuanluoboPlayer `json:"list"`
	}
	result, err := getYuanluobo[struct {
		List []YuanluoboPlayer `json:"list"`
	}](ctx, c, auth, "/r2/usercenter/v2/players", url.Values{"groupId": {groupID}})
	if err != nil {
		return nil, err
	}
	out = result
	return out.List, nil
}

func (c *YuanluoboClient) Records(ctx context.Context, auth YuanluoboAuth, in YuanluoboRecordListRequest) (YuanluoboRecordList, error) {
	return postYuanluobo[YuanluoboRecordList](ctx, c, auth, "/r2/chess/wq/sdr/v1/record/list", in)
}

func (c *YuanluoboClient) Detail(ctx context.Context, auth YuanluoboAuth, sessionID string) (yuanluoboGameData, error) {
	var body = map[string]string{"sessionId": sessionID}
	return postYuanluobo[yuanluoboGameData](ctx, c, auth, "/r2/chess/wq/sdr/v3/record/detail", body)
}

func (c *YuanluoboClient) Logout(ctx context.Context, auth YuanluoboAuth) error {
	_, err := postYuanluobo[json.RawMessage](ctx, c, auth, "/sso/v1/logout", map[string]any{})
	return err
}
```

Add shared request helpers:

```go
func getYuanluobo[T any](ctx context.Context, c *YuanluoboClient, auth YuanluoboAuth, path string, query url.Values) (T, error) {
	if query != nil && len(query) > 0 {
		path += "?" + query.Encode()
	}
	return doYuanluobo[T](ctx, c, auth, http.MethodGet, path, nil)
}

func postYuanluobo[T any](ctx context.Context, c *YuanluoboClient, auth YuanluoboAuth, path string, body any) (T, error) {
	data, err := json.Marshal(body)
	if err != nil {
		var zero T
		return zero, err
	}
	return doYuanluobo[T](ctx, c, auth, http.MethodPost, path, data)
}

func doYuanluobo[T any](ctx context.Context, c *YuanluoboClient, auth YuanluoboAuth, method, path string, body []byte) (T, error) {
	var zero T
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return zero, err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("SERVER-VERSION", "1.0.1")
	req.Header.Set("SOURCE", "APP")
	req.Header.Set("CLIENT-TYPE", "APP")
	req.Header.Set("AUTH-PRODUCT-NAME", "SenseRobot-Go")
	req.Header.Set("Accept-Language", "zh-CN")
	if auth.Token != "" {
		req.Header.Set("AUTH-TOKEN", auth.Token)
	}
	if auth.UID != "" {
		req.Header.Set("AUTH-USERID", auth.UID)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return zero, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return zero, err
	}
	if resp.StatusCode == http.StatusUnauthorized {
		return zero, YuanluoboAuthInvalidError{Message: extractYuanluoboMessage(raw)}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return zero, fmt.Errorf("yuanluobo http status %d", resp.StatusCode)
	}
	var envelope yuanluoboEnvelope[T]
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return zero, err
	}
	if envelope.Code == 200401 || envelope.Code == 20120 {
		return zero, YuanluoboAuthInvalidError{Message: envelope.Message}
	}
	if envelope.Code != 100000 {
		if envelope.Message == "" {
			envelope.Message = fmt.Sprintf("yuanluobo api code %d", envelope.Code)
		}
		return zero, errors.New(envelope.Message)
	}
	return envelope.Data, nil
}

func extractYuanluoboMessage(raw []byte) string {
	var envelope struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(raw, &envelope); err == nil {
		return envelope.Message
	}
	return ""
}
```

- [ ] **Step 4: Run client tests**

Run: `go test ./internal/app -run TestYuanluoboClient -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add internal/app/yuanluobo_client.go internal/app/yuanluobo_client_test.go
git commit -m "feat: add yuanluobo api client"
```

---

### Task 4: Add YuanluoBo Service and Record Mapping

**Files:**
- Create: `internal/app/yuanluobo.go`
- Test: `internal/app/yuanluobo_client_test.go`

- [ ] **Step 1: Add mapping tests**

Append to `internal/app/yuanluobo_client_test.go`:

```go
func TestYuanluoboRecordCategoryName(t *testing.T) {
	cases := map[int]string{
		0:  "全部",
		1:  "元萝卜AI",
		15: "星阵AI",
		2:  "巅峰对决",
		5:  "99围棋",
		6:  "新博围棋",
		7:  "弈客少儿",
		8:  "弈客围棋",
		9:  "佳弈围棋",
		4:  "五子棋",
		3:  "好友约战",
		13: "野狐成人",
		14: "野狐少儿",
		17: "赛事",
	}
	for mode, want := range cases {
		if got := YuanluoboCategoryName(mode); got != want {
			t.Fatalf("mode %d category = %q, want %q", mode, got, want)
		}
	}
	if got := YuanluoboCategoryName(99); got != "其他" {
		t.Fatalf("unknown category = %q", got)
	}
}
```

- [ ] **Step 2: Run failing mapping test**

Run: `go test ./internal/app -run TestYuanluoboRecordCategoryName -v`

Expected: FAIL because category mapping does not exist.

- [ ] **Step 3: Implement service interface and record models**

Create `internal/app/yuanluobo.go`:

```go
package app

import (
	"context"
	"errors"
	"time"
)

const yuanluoboSourcePlatform = "yuanluobo"

type YuanluoboBackend interface {
	LoginStart(ctx context.Context) (YuanluoboQRCode, error)
	LoginPoll(ctx context.Context, key string) (YuanluoboLoginPoll, error)
	Status(ctx context.Context) (YuanluoboStatusResult, error)
	Logout(ctx context.Context) error
	Players(ctx context.Context) ([]YuanluoboPlayer, error)
	Records(ctx context.Context, in YuanluoboRecordListRequest) (YuanluoboRecordList, error)
	DetailSGF(ctx context.Context, sessionID string) (sgf string, displayName string, err error)
	ClearAuth(ctx context.Context) error
}

type YuanluoboServiceOptions struct {
	AuthStore  YuanluoboAuthStore
	HTTPClient *http.Client
	BaseURL    string
}

type YuanluoboService struct {
	authStore YuanluoboAuthStore
	client    *YuanluoboClient
}

type YuanluoboStatusResult struct {
	LoggedIn bool            `json:"loggedIn"`
	User     *YuanluoboUser  `json:"user,omitempty"`
}

type YuanluoboRecordCategory struct {
	Title    string `json:"title"`
	GameMode int    `json:"gameMode"`
}

var yuanluoboCategories = []YuanluoboRecordCategory{
	{Title: "全部", GameMode: 0},
	{Title: "元萝卜AI", GameMode: 1},
	{Title: "星阵AI", GameMode: 15},
	{Title: "巅峰对决", GameMode: 2},
	{Title: "99围棋", GameMode: 5},
	{Title: "新博围棋", GameMode: 6},
	{Title: "弈客少儿", GameMode: 7},
	{Title: "弈客围棋", GameMode: 8},
	{Title: "佳弈围棋", GameMode: 9},
	{Title: "五子棋", GameMode: 4},
	{Title: "好友约战", GameMode: 3},
	{Title: "野狐成人", GameMode: 13},
	{Title: "野狐少儿", GameMode: 14},
	{Title: "赛事", GameMode: 17},
}

func YuanluoboCategories() []YuanluoboRecordCategory {
	out := make([]YuanluoboRecordCategory, len(yuanluoboCategories))
	copy(out, yuanluoboCategories)
	return out
}

func YuanluoboCategoryName(gameMode int) string {
	for _, category := range yuanluoboCategories {
		if category.GameMode == gameMode {
			return category.Title
		}
	}
	return "其他"
}
```

Add service methods:

```go
func NewYuanluoboService(opts YuanluoboServiceOptions) *YuanluoboService {
	authStore := opts.AuthStore
	if authStore == nil {
		authStore = NewYuanluoboMemoryAuthStore()
	}
	return &YuanluoboService{
		authStore: authStore,
		client:    NewYuanluoboClient(opts.BaseURL, opts.HTTPClient),
	}
}

func (s *YuanluoboService) LoginStart(ctx context.Context) (YuanluoboQRCode, error) {
	return s.client.LoginStart(ctx)
}

func (s *YuanluoboService) LoginPoll(ctx context.Context, key string) (YuanluoboLoginPoll, error) {
	poll, err := s.client.LoginPoll(ctx, key)
	if err != nil {
		return YuanluoboLoginPoll{}, err
	}
	if poll.Status == YuanluoboQRLogined {
		if poll.Token == "" || poll.UID == "" {
			return YuanluoboLoginPoll{}, errors.New("yuanluobo login response missing token or uid")
		}
		if err := s.authStore.Save(ctx, YuanluoboAuth{Token: poll.Token, UID: poll.UID}); err != nil {
			return YuanluoboLoginPoll{}, err
		}
	}
	poll.Token = ""
	return poll, nil
}

func (s *YuanluoboService) Status(ctx context.Context) (YuanluoboStatusResult, error) {
	auth, ok, err := s.authStore.Load(ctx)
	if err != nil || !ok {
		return YuanluoboStatusResult{LoggedIn: false}, err
	}
	user, err := s.client.UserInfo(ctx, auth)
	if IsYuanluoboAuthInvalid(err) {
		_ = s.authStore.Clear(ctx)
		return YuanluoboStatusResult{LoggedIn: false}, nil
	}
	if err != nil {
		return YuanluoboStatusResult{}, err
	}
	return YuanluoboStatusResult{LoggedIn: true, User: &user}, nil
}

func (s *YuanluoboService) Logout(ctx context.Context) error {
	auth, ok, err := s.authStore.Load(ctx)
	if err != nil {
		return err
	}
	if ok {
		if err := s.client.Logout(ctx, auth); err != nil && !IsYuanluoboAuthInvalid(err) {
			return err
		}
	}
	return s.authStore.Clear(ctx)
}

func (s *YuanluoboService) Players(ctx context.Context) ([]YuanluoboPlayer, error) {
	auth, user, err := s.authenticatedUser(ctx)
	if err != nil {
		return nil, err
	}
	return s.client.Players(ctx, auth, user.GroupID)
}

func (s *YuanluoboService) Records(ctx context.Context, in YuanluoboRecordListRequest) (YuanluoboRecordList, error) {
	auth, _, err := s.authenticatedUser(ctx)
	if err != nil {
		return YuanluoboRecordList{}, err
	}
	if in.Page <= 0 {
		in.Page = 1
	}
	in.Size = 10
	return s.client.Records(ctx, auth, in)
}

func (s *YuanluoboService) DetailSGF(ctx context.Context, sessionID string) (string, string, error) {
	auth, _, err := s.authenticatedUser(ctx)
	if err != nil {
		return "", "", err
	}
	data, err := s.client.Detail(ctx, auth, sessionID)
	if IsYuanluoboAuthInvalid(err) {
		_ = s.authStore.Clear(ctx)
	}
	if err != nil {
		return "", "", err
	}
	return convertYuanluoboToSGF(data), yuanluoboDisplayName(data), nil
}

func (s *YuanluoboService) ClearAuth(ctx context.Context) error {
	return s.authStore.Clear(ctx)
}

func (s *YuanluoboService) authenticatedUser(ctx context.Context) (YuanluoboAuth, YuanluoboUser, error) {
	auth, ok, err := s.authStore.Load(ctx)
	if err != nil {
		return YuanluoboAuth{}, YuanluoboUser{}, err
	}
	if !ok {
		return YuanluoboAuth{}, YuanluoboUser{}, YuanluoboAuthInvalidError{Message: "元萝卜未登录"}
	}
	user, err := s.client.UserInfo(ctx, auth)
	if IsYuanluoboAuthInvalid(err) {
		_ = s.authStore.Clear(ctx)
	}
	if err != nil {
		return YuanluoboAuth{}, YuanluoboUser{}, err
	}
	return auth, user, nil
}

func yuanluoboUnixDate(seconds int64) string {
	if seconds <= 0 {
		return ""
	}
	return time.Unix(seconds, 0).UTC().Format("2006-01-02")
}
```

Add `net/http` to imports.

- [ ] **Step 4: Add display helper in SGF import**

In `internal/app/sgf_import.go`, add:

```go
func yuanluoboDisplayName(data yuanluoboGameData) string {
	return fmt.Sprintf("%s vs %s", data.BlackPlayerName, data.WhitePlayerName)
}
```

Change `fetchYuanluoboSGF`:

```go
displayName = yuanluoboDisplayName(result.Data)
```

- [ ] **Step 5: Run mapping and existing import tests**

Run: `go test ./internal/app -run "TestYuanluoboRecordCategoryName|TestConvertYuanluoboToSGF" -v`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add internal/app/yuanluobo.go internal/app/yuanluobo_client_test.go internal/app/sgf_import.go
git commit -m "feat: add yuanluobo service model"
```

---

### Task 5: Add YuanluoBo JSON-RPC Handlers

**Files:**
- Create: `internal/app/yuanluobo_handlers.go`
- Modify: `internal/app/handlers.go`
- Modify: `internal/app/app.go`
- Modify: `internal/app/workspace.go`
- Test: `internal/app/handlers_test.go`

- [ ] **Step 1: Write RPC handler tests**

Add fake backend and tests to `internal/app/handlers_test.go`:

```go
type fakeYuanluoboBackend struct {
	status  YuanluoboStatusResult
	players []YuanluoboPlayer
	records YuanluoboRecordList
	sgf     string
	name    string
	cleared bool
}

func (f *fakeYuanluoboBackend) LoginStart(context.Context) (YuanluoboQRCode, error) {
	return YuanluoboQRCode{Key: "key-1", Image: "image-1"}, nil
}

func (f *fakeYuanluoboBackend) LoginPoll(context.Context, string) (YuanluoboLoginPoll, error) {
	return YuanluoboLoginPoll{Status: YuanluoboQRLogined, Desc: "已登录"}, nil
}

func (f *fakeYuanluoboBackend) Status(context.Context) (YuanluoboStatusResult, error) {
	return f.status, nil
}

func (f *fakeYuanluoboBackend) Logout(context.Context) error {
	f.cleared = true
	return nil
}

func (f *fakeYuanluoboBackend) Players(context.Context) ([]YuanluoboPlayer, error) {
	return f.players, nil
}

func (f *fakeYuanluoboBackend) Records(context.Context, in YuanluoboRecordListRequest) (YuanluoboRecordList, error) {
	f.records.Page = in.Page
	f.records.Size = 10
	return f.records, nil
}

func (f *fakeYuanluoboBackend) DetailSGF(context.Context, string) (string, string, error) {
	return f.sgf, f.name, nil
}

func (f *fakeYuanluoboBackend) ClearAuth(context.Context) error {
	f.cleared = true
	return nil
}

func TestYuanluoboRecordsMarksImportedGames(t *testing.T) {
	h, token := newTestHandler(t)
	fake := &fakeYuanluoboBackend{
		records: YuanluoboRecordList{
			Total: 2, Page: 1, Size: 10, PageTotal: 1,
			List: []YuanluoboRemoteRecord{
				{SessionID: "session-imported", GameMode: 1, StartTime: 1783500000, BlackPlayerName: "A", WhitePlayerName: "B"},
				{SessionID: "session-new", GameMode: 15, StartTime: 1783400000, BlackPlayerName: "C", WhitePlayerName: "D"},
			},
		},
	}
	h.yuanluobo = fake
	imported, err := h.repo.CreateGame(context.Background(), store.CreateGameInput{
		DisplayName: "Imported",
		Result: "B+R",
		SourcePlatform: yuanluoboSourcePlatform,
		SourceID: "session-imported",
	})
	if err != nil {
		t.Fatal(err)
	}

	out := callResult[YuanluoboRecordsResult](t, h, token, "yuanluobo.records", map[string]any{
		"playerId": "player-1",
		"gameMode": 1,
		"page": 1,
	})
	if len(out.Records) != 2 {
		t.Fatalf("records = %#v", out)
	}
	if !out.Records[0].Imported || out.Records[0].GameID != imported.ID {
		t.Fatalf("imported marker = %#v", out.Records[0])
	}
	if out.Records[1].Imported || out.Records[1].GameID != "" {
		t.Fatalf("new marker = %#v", out.Records[1])
	}
}

func TestYuanluoboImportRecordCreatesAndDeduplicates(t *testing.T) {
	h, token := newTestHandler(t)
	h.yuanluobo = &fakeYuanluoboBackend{
		sgf:  "(;GM[1]FF[4]SZ[19]RE[B+R]DT[2026-07-08]PB[Black]PW[White];B[pd])",
		name: "Black vs White",
	}

	first := callResult[ImportResult](t, h, token, "yuanluobo.importRecord", map[string]any{"sessionId": "session-1"})
	second := callResult[ImportResult](t, h, token, "yuanluobo.importRecord", map[string]any{"sessionId": "session-1"})
	if first.Game.ID != second.Game.ID {
		t.Fatalf("dedupe failed: %s vs %s", first.Game.ID, second.Game.ID)
	}
	stored, err := h.repo.GetGame(context.Background(), first.Game.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.SourcePlatform != yuanluoboSourcePlatform || stored.SourceID != "session-1" {
		t.Fatalf("stored source = %#v", stored)
	}
}
```

- [ ] **Step 2: Run failing RPC tests**

Run: `go test ./internal/app -run "TestYuanluoboRecordsMarksImportedGames|TestYuanluoboImportRecordCreatesAndDeduplicates" -v`

Expected: FAIL because RPC methods and result types do not exist.

- [ ] **Step 3: Wire handler options**

In `internal/app/handlers.go`, add a YuanluoBo field and options while keeping existing tests working:

```go
type Handler struct {
	repo       *store.Repository
	files      store.FileStore
	workspaces *WorkspaceStore
	analysis   AnalysisController
	yuanluobo  YuanluoboBackend
}

type HandlerOptions struct {
	YuanluoboAuthStore  YuanluoboAuthStore
	YuanluoboHTTPClient *http.Client
	YuanluoboBaseURL    string
}

func NewHandler(repo *store.Repository, files store.FileStore, workspaces *WorkspaceStore, analysis AnalysisController) *Handler {
	return NewHandlerWithOptions(repo, files, workspaces, analysis, HandlerOptions{})
}

func NewHandlerWithOptions(repo *store.Repository, files store.FileStore, workspaces *WorkspaceStore, analysis AnalysisController, opts HandlerOptions) *Handler {
	authStore := opts.YuanluoboAuthStore
	if authStore == nil {
		authStore = NewYuanluoboMemoryAuthStore()
	}
	ylb := NewYuanluoboService(YuanluoboServiceOptions{
		AuthStore:  authStore,
		HTTPClient: opts.YuanluoboHTTPClient,
		BaseURL:    opts.YuanluoboBaseURL,
	})
	h := &Handler{repo: repo, files: files, workspaces: workspaces, analysis: analysis, yuanluobo: ylb}
	if analysis != nil {
		analysis.Subscribe(func(event Event) {
			ws := h.workspaces.ForToken(event.Token)
			ws.SetAnalysis(event.GameID, event.NodeID, event.Analysis)
			if !event.IsDuringSearch && strings.HasPrefix(event.NodeID, "main:") {
				h.persistMainlineAnalysis(context.Background(), event.GameID, ws)
			}
		})
	}
	return h
}
```

Add `net/http` to imports in `handlers.go`.

In `internal/app/app.go`, wire production auth to `.data`:

```go
handler := NewHandlerWithOptions(repo, files, workspaces, scheduler, HandlerOptions{
	YuanluoboAuthStore: NewYuanluoboFileAuthStore(filepath.Join(cfg.DataDir, "yuanluobo_auth.json")),
})
```

Add `path/filepath` to `app.go` imports.

- [ ] **Step 4: Implement RPC result types and handlers**

Create `internal/app/yuanluobo_handlers.go`:

```go
package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"jcgo/internal/game"
	"jcgo/internal/store"
)

type YuanluoboRecordsResult struct {
	Total      int                    `json:"total"`
	Page       int                    `json:"page"`
	Size       int                    `json:"size"`
	PageTotal  int                    `json:"pageTotal"`
	Categories []YuanluoboRecordCategory `json:"categories"`
	Records    []YuanluoboRecordView `json:"records"`
}

type YuanluoboRecordView struct {
	SessionID       string `json:"sessionId"`
	GameMode        int    `json:"gameMode"`
	Category        string `json:"category"`
	StartDate       string `json:"startDate"`
	StartTime       int64  `json:"startTime"`
	BlackPlayerName string `json:"blackPlayerName"`
	WhitePlayerName string `json:"whitePlayerName"`
	Title           string `json:"title"`
	Result          string `json:"result"`
	TotalRound      int    `json:"totalRound"`
	Imported        bool   `json:"imported"`
	GameID          string `json:"gameId,omitempty"`
}

type yuanluoboLoginPollParams struct {
	Key string `json:"key"`
}

type yuanluoboRecordsParams struct {
	PlayerID string `json:"playerId"`
	GameMode int    `json:"gameMode"`
	Page     int    `json:"page"`
}

type yuanluoboImportRecordParams struct {
	SessionID string `json:"sessionId"`
}
```

Add handler methods:

```go
func (h *Handler) yuanluoboLoginStart(ctx context.Context) (YuanluoboQRCode, error) {
	return h.yuanluobo.LoginStart(ctx)
}

func (h *Handler) yuanluoboLoginPoll(ctx context.Context, params json.RawMessage) (YuanluoboLoginPoll, error) {
	var in yuanluoboLoginPollParams
	if err := decodeParams(params, &in); err != nil {
		return YuanluoboLoginPoll{}, err
	}
	if strings.TrimSpace(in.Key) == "" {
		return YuanluoboLoginPoll{}, errors.New("key is required")
	}
	return h.yuanluobo.LoginPoll(ctx, in.Key)
}

func (h *Handler) yuanluoboRecords(ctx context.Context, params json.RawMessage) (YuanluoboRecordsResult, error) {
	var in yuanluoboRecordsParams
	if err := decodeParams(params, &in); err != nil {
		return YuanluoboRecordsResult{}, err
	}
	records, err := h.yuanluobo.Records(ctx, YuanluoboRecordListRequest{
		Page: in.Page, Size: 10, PlayerID: in.PlayerID, GameMode: in.GameMode,
	})
	if IsYuanluoboAuthInvalid(err) {
		_ = h.yuanluobo.ClearAuth(ctx)
	}
	if err != nil {
		return YuanluoboRecordsResult{}, err
	}
	out := YuanluoboRecordsResult{
		Total: records.Total, Page: records.Page, Size: records.Size, PageTotal: records.PageTotal,
		Categories: YuanluoboCategories(),
		Records: make([]YuanluoboRecordView, 0, len(records.List)),
	}
	for _, item := range records.List {
		view := yuanluoboRecordView(item)
		if existing, ok, err := h.repo.FindGameBySource(ctx, yuanluoboSourcePlatform, item.SessionID); err != nil {
			return YuanluoboRecordsResult{}, err
		} else if ok {
			view.Imported = true
			view.GameID = existing.ID
		}
		out.Records = append(out.Records, view)
	}
	return out, nil
}

func (h *Handler) yuanluoboImportRecord(ctx context.Context, token string, params json.RawMessage) (ImportResult, error) {
	var in yuanluoboImportRecordParams
	if err := decodeParams(params, &in); err != nil {
		return ImportResult{}, err
	}
	sessionID := strings.TrimSpace(in.SessionID)
	if sessionID == "" {
		return ImportResult{}, errors.New("sessionId is required")
	}
	if existing, ok, err := h.repo.FindGameBySource(ctx, yuanluoboSourcePlatform, sessionID); err != nil {
		return ImportResult{}, err
	} else if ok {
		return h.openExistingImport(ctx, token, existing)
	}
	sgfText, displayName, err := h.yuanluobo.DetailSGF(ctx, sessionID)
	if IsYuanluoboAuthInvalid(err) {
		_ = h.yuanluobo.ClearAuth(ctx)
	}
	if err != nil {
		return ImportResult{}, err
	}
	return h.importSGFText(ctx, token, sgfText, displayName, store.CreateGameInput{
		SourcePlatform: yuanluoboSourcePlatform,
		SourceID: sessionID,
	})
}
```

Add helpers:

```go
func yuanluoboRecordView(item YuanluoboRemoteRecord) YuanluoboRecordView {
	title := item.RobotStrength
	if title == "" {
		title = YuanluoboCategoryName(item.GameMode)
	}
	return YuanluoboRecordView{
		SessionID: item.SessionID,
		GameMode: item.GameMode,
		Category: YuanluoboCategoryName(item.GameMode),
		StartDate: yuanluoboUnixDate(item.StartTime),
		StartTime: item.StartTime,
		BlackPlayerName: item.BlackPlayerName,
		WhitePlayerName: item.WhitePlayerName,
		Title: title,
		Result: formatYuanluoboResult(yuanluoboGameData{WinPieces: item.WinPieces}),
		TotalRound: item.TotalRound,
	}
}

func (h *Handler) openExistingImport(ctx context.Context, token string, record store.GameRecord) (ImportResult, error) {
	ws := h.workspaces.ForToken(token)
	if err := h.ensureWorkspaceRecord(ctx, token, record); err != nil {
		return ImportResult{}, err
	}
	snapshot, err := ws.CurrentSnapshot(record.ID)
	if err != nil {
		return ImportResult{}, err
	}
	return ImportResult{Game: record, Snapshot: snapshot}, nil
}
```

- [ ] **Step 5: Refactor shared import helper**

In `internal/app/handlers.go`, extract SGF storage from `importSGF`:

```go
func (h *Handler) importSGFText(ctx context.Context, token string, sgfText string, displayName string, create store.CreateGameInput) (ImportResult, error) {
	doc, err := game.ParseSGF(sgfText)
	if err != nil {
		return ImportResult{}, err
	}
	create.DisplayName = displayName
	create.Result = doc.Result
	create.GameDate = doc.GameDate
	record, err := h.repo.CreateGame(ctx, create)
	if err != nil {
		return ImportResult{}, err
	}
	record.AnalysisStatus = string(AnalysisIdle)
	if _, err := h.files.WriteSGF(record.SGFFilename, sgfText); err != nil {
		_ = h.repo.DeleteGame(ctx, record.ID)
		return ImportResult{}, err
	}
	ws := h.workspaces.ForToken(token)
	if err := ws.LoadGame(record.ID, doc); err != nil {
		_ = h.repo.DeleteGame(ctx, record.ID)
		_ = h.files.DeleteSGF(record.SGFFilename)
		return ImportResult{}, err
	}
	snapshot, err := ws.CurrentSnapshot(record.ID)
	if err != nil {
		return ImportResult{}, err
	}
	return ImportResult{Game: record, Snapshot: snapshot}, nil
}
```

Then `importSGF` calls:

```go
return h.importSGFText(ctx, token, sgfText, displayName, store.CreateGameInput{})
```

If `ensureWorkspaceRecord` does not exist, add it near `ensureWorkspaceGame` in `handlers.go`:

```go
func (h *Handler) ensureWorkspaceRecord(ctx context.Context, token string, record store.GameRecord) error {
	ws := h.workspaces.ForToken(token)
	if ws.HasGame(record.ID) {
		return nil
	}
	sgfText, err := h.files.ReadSGF(record.SGFFilename)
	if err != nil {
		return err
	}
	doc, err := game.ParseSGF(sgfText)
	if err != nil {
		return err
	}
	if err := ws.LoadGame(record.ID, doc); err != nil {
		return err
	}
	h.loadPersistedAnalysis(ws, record)
	return nil
}
```

If `Workspace.HasGame` does not exist, add to `internal/app/workspace.go`:

```go
func (w *Workspace) HasGame(gameID string) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	_, ok := w.games[gameID]
	return ok
}
```

- [ ] **Step 6: Add RPC dispatch**

In `Handler.Call`, add cases:

```go
case "yuanluobo.loginStart":
	return h.yuanluoboLoginStart(ctx)
case "yuanluobo.loginPoll":
	return h.yuanluoboLoginPoll(ctx, params)
case "yuanluobo.status":
	return h.yuanluobo.Status(ctx)
case "yuanluobo.logout":
	return nil, h.yuanluobo.Logout(ctx)
case "yuanluobo.players":
	return h.yuanluobo.Players(ctx)
case "yuanluobo.records":
	return h.yuanluoboRecords(ctx, params)
case "yuanluobo.importRecord":
	return h.yuanluoboImportRecord(ctx, token, params)
```

- [ ] **Step 7: Run RPC tests**

Run: `go test ./internal/app -run "TestYuanluoboRecordsMarksImportedGames|TestYuanluoboImportRecordCreatesAndDeduplicates" -v`

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add internal/app/yuanluobo_handlers.go internal/app/handlers.go internal/app/workspace.go internal/app/handlers_test.go
git commit -m "feat: expose yuanluobo import rpc"
```

---

### Task 6: Add Frontend YuanluoBo Types and Login UI

**Files:**
- Modify: `web/src/api/types.ts`
- Create: `web/src/components/YuanluoboImportDialog.tsx`
- Test: `web/src/components/YuanluoboImportDialog.test.tsx`

- [ ] **Step 1: Add frontend API types**

Append to `web/src/api/types.ts`:

```ts
export interface YuanluoboQRCode {
  key: string
  image: string
}

export type YuanluoboQRStatusCode = 0 | 1 | 2 | 3 | 4

export interface YuanluoboLoginPoll {
  status: YuanluoboQRStatusCode
  desc: string
}

export interface YuanluoboUser {
  id: number
  playerId: string
  name: string
  groupId: string
  userId: string
  avatarUrl?: string
}

export interface YuanluoboStatusResult {
  loggedIn: boolean
  user?: YuanluoboUser
}

export interface YuanluoboPlayer {
  playerId: string
  name: string
  avatarUrl?: string
  groupId?: string
}

export interface YuanluoboCategory {
  title: string
  gameMode: number
}

export interface YuanluoboRecord {
  sessionId: string
  gameMode: number
  category: string
  startDate: string
  startTime: number
  blackPlayerName: string
  whitePlayerName: string
  title: string
  result: string
  totalRound: number
  imported: boolean
  gameId?: string
}

export interface YuanluoboRecordsResult {
  total: number
  page: number
  size: number
  pageTotal: number
  categories: YuanluoboCategory[]
  records: YuanluoboRecord[]
}
```

- [ ] **Step 2: Write login UI tests**

Create `web/src/components/YuanluoboImportDialog.test.tsx`:

```tsx
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { YuanluoboImportDialog, type YuanluoboImportAPI } from './YuanluoboImportDialog'

function api(overrides: Partial<YuanluoboImportAPI> = {}): YuanluoboImportAPI {
  return {
    status: vi.fn(() => Promise.resolve({ loggedIn: false })),
    loginStart: vi.fn(() => Promise.resolve({ key: 'key-1', image: 'jpeg-base64' })),
    loginPoll: vi.fn(() => Promise.resolve({ status: 0, desc: '未扫码' })),
    logout: vi.fn(() => Promise.resolve()),
    players: vi.fn(() => Promise.resolve([])),
    records: vi.fn(() => Promise.resolve({ total: 0, page: 1, size: 10, pageTotal: 0, categories: [], records: [] })),
    importRecord: vi.fn(),
    ...overrides,
  }
}

describe('YuanluoboImportDialog', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows scan login when yuanluobo is not logged in', async () => {
    render(<YuanluoboImportDialog api={api()} onOpenGame={vi.fn()} onBack={vi.fn()} />)

    expect(await screen.findByText('元萝卜扫码登录')).toBeInTheDocument()
    expect(await screen.findByAltText('元萝卜登录二维码')).toHaveAttribute('src', 'data:image/jpeg;base64,jpeg-base64')
    expect(screen.getByText('请使用元萝卜 App 扫码确认')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run failing frontend test**

Run:

```powershell
cd web
npm test -- --run src/components/YuanluoboImportDialog.test.tsx
```

Expected: FAIL because `YuanluoboImportDialog` does not exist.

- [ ] **Step 4: Implement login UI shell**

Create `web/src/components/YuanluoboImportDialog.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import type {
  ImportResult,
  YuanluoboLoginPoll,
  YuanluoboPlayer,
  YuanluoboQRCode,
  YuanluoboRecord,
  YuanluoboRecordsResult,
  YuanluoboStatusResult,
} from '../api/types'

export interface YuanluoboImportAPI {
  status(): Promise<YuanluoboStatusResult>
  loginStart(): Promise<YuanluoboQRCode>
  loginPoll(key: string): Promise<YuanluoboLoginPoll>
  logout(): Promise<void>
  players(): Promise<YuanluoboPlayer[]>
  records(params: { playerId: string; gameMode: number; page: number }): Promise<YuanluoboRecordsResult>
  importRecord(sessionId: string): Promise<ImportResult>
}

interface YuanluoboImportDialogProps {
  api: YuanluoboImportAPI
  onOpenGame(gameId: string): void | Promise<void>
  onBack(): void
}

type LoginState = 'checking' | 'logged-out' | 'polling' | 'logged-in'

export function YuanluoboImportDialog({ api, onOpenGame, onBack }: YuanluoboImportDialogProps) {
  const [loginState, setLoginState] = useState<LoginState>('checking')
  const [qr, setQR] = useState<YuanluoboQRCode>()
  const [pollDesc, setPollDesc] = useState('未扫码')
  const [error, setError] = useState<string>()
  const pollTimer = useRef<number>()

  useEffect(() => {
    let cancelled = false
    api.status()
      .then((status) => {
        if (cancelled) return
        if (status.loggedIn) setLoginState('logged-in')
        else {
          setLoginState('logged-out')
          void startLogin()
        }
      })
      .catch((reason) => {
        if (!cancelled) setError(errorMessage(reason))
      })
    return () => {
      cancelled = true
      if (pollTimer.current !== undefined) window.clearInterval(pollTimer.current)
    }
  }, [])

  const startLogin = async () => {
    if (pollTimer.current !== undefined) window.clearInterval(pollTimer.current)
    setError(undefined)
    setPollDesc('未扫码')
    const nextQR = await api.loginStart()
    setQR(nextQR)
    setLoginState('polling')
    pollTimer.current = window.setInterval(() => {
      void pollLogin(nextQR.key)
    }, 3000)
    void pollLogin(nextQR.key)
  }

  const pollLogin = async (key: string) => {
    try {
      const result = await api.loginPoll(key)
      setPollDesc(result.desc || qrStatusLabel(result.status))
      if (result.status === 2) {
        if (pollTimer.current !== undefined) window.clearInterval(pollTimer.current)
        setLoginState('logged-in')
      }
      if (result.status === 3 && pollTimer.current !== undefined) {
        window.clearInterval(pollTimer.current)
      }
    } catch (reason) {
      if (pollTimer.current !== undefined) window.clearInterval(pollTimer.current)
      setError(errorMessage(reason))
    }
  }

  if (loginState === 'checking') {
    return <div className="yuanluobo-panel">正在检查元萝卜登录...</div>
  }

  if (loginState !== 'logged-in') {
    return (
      <div className="yuanluobo-panel">
        <header className="yuanluobo-header">
          <button onClick={onBack}>返回</button>
          <strong>元萝卜扫码登录</strong>
        </header>
        {qr && <img className="yuanluobo-qr" src={`data:image/jpeg;base64,${qr.image}`} alt="元萝卜登录二维码" />}
        <p className="yuanluobo-muted">请使用元萝卜 App 扫码确认</p>
        <p className="yuanluobo-muted">{pollDesc}</p>
        {error && <p className="import-error">{error}</p>}
        <button onClick={() => void startLogin()}>刷新二维码</button>
      </div>
    )
  }

  return <YuanluoboRecordBrowser api={api} onOpenGame={onOpenGame} onBack={onBack} />
}

function YuanluoboRecordBrowser({ onBack }: YuanluoboImportDialogProps) {
  return (
    <div className="yuanluobo-panel">
      <header className="yuanluobo-header">
        <button onClick={onBack}>返回</button>
        <strong>元萝卜棋局</strong>
      </header>
    </div>
  )
}

function qrStatusLabel(status: number) {
  if (status === 1) return '扫码成功，请在手机上确认'
  if (status === 2) return '登录成功'
  if (status === 3) return '二维码已过期'
  return '未扫码'
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : '元萝卜请求失败'
}
```

- [ ] **Step 5: Run login UI test**

Run:

```powershell
cd web
npm test -- --run src/components/YuanluoboImportDialog.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add web/src/api/types.ts web/src/components/YuanluoboImportDialog.tsx web/src/components/YuanluoboImportDialog.test.tsx
git commit -m "feat: add yuanluobo login dialog"
```

---

### Task 7: Add Frontend Record Browser Behavior

**Files:**
- Modify: `web/src/components/YuanluoboImportDialog.tsx`
- Test: `web/src/components/YuanluoboImportDialog.test.tsx`

- [ ] **Step 1: Add browser tests**

Append to `web/src/components/YuanluoboImportDialog.test.tsx`:

```tsx
it('loads categories, records, and marks imported games', async () => {
  const testAPI = api({
    status: vi.fn(() => Promise.resolve({ loggedIn: true })),
    players: vi.fn(() => Promise.resolve([{ playerId: 'player-1', name: '棋手一' }])),
    records: vi.fn(() => Promise.resolve({
      total: 2,
      page: 1,
      size: 10,
      pageTotal: 1,
      categories: [{ title: '全部', gameMode: 0 }, { title: '星阵AI', gameMode: 15 }],
      records: [
        {
          sessionId: 'session-1',
          gameMode: 15,
          category: '星阵AI',
          startDate: '2026-07-08',
          startTime: 1783500000,
          blackPlayerName: 'Black',
          whitePlayerName: 'White',
          title: '星阵AI',
          result: 'B+3.50',
          totalRound: 120,
          imported: true,
          gameId: 'game-1',
        },
      ],
    })),
  })

  render(<YuanluoboImportDialog api={testAPI} onOpenGame={vi.fn()} onBack={vi.fn()} />)

  expect(await screen.findByText('棋手一')).toBeInTheDocument()
  expect(await screen.findByRole('button', { name: '星阵AI' })).toBeInTheDocument()
  expect(screen.getByText('Black vs White')).toBeInTheDocument()
  expect(screen.getByText('已导入')).toBeInTheDocument()
})

it('opens imported games and imports new games', async () => {
  const onOpenGame = vi.fn()
  const testAPI = api({
    status: vi.fn(() => Promise.resolve({ loggedIn: true })),
    players: vi.fn(() => Promise.resolve([{ playerId: 'player-1', name: '棋手一' }])),
    records: vi.fn(() => Promise.resolve({
      total: 2,
      page: 1,
      size: 10,
      pageTotal: 1,
      categories: [{ title: '全部', gameMode: 0 }],
      records: [
        {
          sessionId: 'session-imported',
          gameMode: 0,
          category: '全部',
          startDate: '2026-07-08',
          startTime: 1783500000,
          blackPlayerName: 'Imported',
          whitePlayerName: 'Opponent',
          title: '全部',
          result: 'B+R',
          totalRound: 90,
          imported: true,
          gameId: 'game-imported',
        },
        {
          sessionId: 'session-new',
          gameMode: 0,
          category: '全部',
          startDate: '2026-07-07',
          startTime: 1783400000,
          blackPlayerName: 'New',
          whitePlayerName: 'Opponent',
          title: '全部',
          result: 'W+2.50',
          totalRound: 100,
          imported: false,
        },
      ],
    })),
    importRecord: vi.fn(() => Promise.resolve({
      game: {
        gameId: 'game-new',
        displayName: 'New vs Opponent',
        result: 'W+2.50',
        sgfFilename: 'game-new.sgf',
        createdAt: '2026-07-08T00:00:00Z',
      },
      snapshot: {} as never,
    })),
  })

  render(<YuanluoboImportDialog api={testAPI} onOpenGame={onOpenGame} onBack={vi.fn()} />)

  await screen.findByText('Imported vs Opponent')
  await screen.getByText('Imported vs Opponent').click()
  expect(onOpenGame).toHaveBeenCalledWith('game-imported')

  await screen.getByText('New vs Opponent').click()
  await waitFor(() => expect(testAPI.importRecord).toHaveBeenCalledWith('session-new'))
  expect(onOpenGame).toHaveBeenCalledWith('game-new')
})
```

- [ ] **Step 2: Run failing browser tests**

Run:

```powershell
cd web
npm test -- --run src/components/YuanluoboImportDialog.test.tsx
```

Expected: FAIL because the browser is only a shell.

- [ ] **Step 3: Implement record browser**

Replace `YuanluoboRecordBrowser` in `YuanluoboImportDialog.tsx`:

```tsx
function YuanluoboRecordBrowser({ api, onOpenGame, onBack }: YuanluoboImportDialogProps) {
  const [players, setPlayers] = useState<YuanluoboPlayer[]>([])
  const [playerId, setPlayerId] = useState('')
  const [categories, setCategories] = useState<{ title: string; gameMode: number }[]>([])
  const [gameMode, setGameMode] = useState(0)
  const [page, setPage] = useState(1)
  const [pageTotal, setPageTotal] = useState(0)
  const [records, setRecords] = useState<YuanluoboRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let cancelled = false
    api.players()
      .then((nextPlayers) => {
        if (cancelled) return
        setPlayers(nextPlayers)
        setPlayerId(nextPlayers[0]?.playerId ?? '')
      })
      .catch((reason) => {
        if (!cancelled) setError(errorMessage(reason))
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!playerId) return
    void loadRecords(playerId, gameMode, page)
  }, [playerId, gameMode, page])

  const loadRecords = async (nextPlayerId: string, nextGameMode: number, nextPage: number) => {
    setLoading(true)
    setError(undefined)
    try {
      const result = await api.records({ playerId: nextPlayerId, gameMode: nextGameMode, page: nextPage })
      setCategories(result.categories)
      setRecords(result.records)
      setPageTotal(result.pageTotal)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setLoading(false)
    }
  }

  const chooseRecord = async (record: YuanluoboRecord) => {
    if (record.imported && record.gameId) {
      await onOpenGame(record.gameId)
      return
    }
    const result = await api.importRecord(record.sessionId)
    await onOpenGame(result.game.gameId)
  }

  return (
    <div className="yuanluobo-panel">
      <header className="yuanluobo-header">
        <button onClick={onBack}>返回</button>
        <strong>元萝卜棋局</strong>
        <button onClick={() => void api.logout().then(onBack)}>退出</button>
      </header>

      <label className="yuanluobo-player-select">
        <span>棋手</span>
        <select value={playerId} onChange={(event) => { setPlayerId(event.target.value); setPage(1) }}>
          {players.map((player) => <option key={player.playerId} value={player.playerId}>{player.name}</option>)}
        </select>
      </label>

      <div className="yuanluobo-tabs" role="tablist" aria-label="元萝卜分类">
        {categories.map((category) => (
          <button
            key={category.gameMode}
            role="tab"
            aria-selected={gameMode === category.gameMode}
            onClick={() => { setGameMode(category.gameMode); setPage(1) }}
          >
            {category.title}
          </button>
        ))}
      </div>

      {error && <p className="import-error">{error}</p>}
      {loading && <p className="yuanluobo-muted">加载中...</p>}

      <div className="yuanluobo-record-list">
        {records.map((record) => (
          <button key={record.sessionId} className="yuanluobo-record-row" onClick={() => void chooseRecord(record)}>
            <span className="yuanluobo-record-title">{record.blackPlayerName} vs {record.whitePlayerName}</span>
            <span className="yuanluobo-record-meta">{record.startDate} · {record.category} · {record.result}</span>
            {record.imported && <span className="yuanluobo-imported-badge">已导入</span>}
          </button>
        ))}
      </div>

      <footer className="yuanluobo-pager">
        <button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button>
        <span>{page} / {Math.max(pageTotal, 1)}</span>
        <button disabled={pageTotal > 0 && page >= pageTotal} onClick={() => setPage((value) => value + 1)}>下一页</button>
      </footer>
    </div>
  )
}
```

- [ ] **Step 4: Run browser tests**

Run:

```powershell
cd web
npm test -- --run src/components/YuanluoboImportDialog.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add web/src/components/YuanluoboImportDialog.tsx web/src/components/YuanluoboImportDialog.test.tsx
git commit -m "feat: browse yuanluobo records"
```

---

### Task 8: Wire YuanluoBo Entry Into Import Flow

**Files:**
- Modify: `web/src/components/ImportDialog.tsx`
- Modify: `web/src/components/ImportDialog.test.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/styles.css`

- [ ] **Step 1: Add ImportDialog test for YuanluoBo entry**

Add to `web/src/components/ImportDialog.test.tsx`:

```tsx
it('opens the yuanluobo import entry from the choose screen', async () => {
  const yuanluoboApi = {
    status: vi.fn(() => Promise.resolve({ loggedIn: false })),
    loginStart: vi.fn(() => Promise.resolve({ key: 'key-1', image: 'jpeg-base64' })),
    loginPoll: vi.fn(() => Promise.resolve({ status: 0 as const, desc: '未扫码' })),
    logout: vi.fn(() => Promise.resolve()),
    players: vi.fn(() => Promise.resolve([])),
    records: vi.fn(() => Promise.resolve({ total: 0, page: 1, size: 10, pageTotal: 0, categories: [], records: [] })),
    importRecord: vi.fn(),
  }
  render(
    <ImportDialog
      onImport={vi.fn()}
      onImportUrl={vi.fn()}
      onCancel={vi.fn()}
      yuanluoboApi={yuanluoboApi}
      onOpenGame={vi.fn()}
    />,
  )

  await userEvent.click(screen.getByRole('button', { name: '元萝卜' }))

  expect(await screen.findByText('元萝卜扫码登录')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run failing ImportDialog test**

Run:

```powershell
cd web
npm test -- --run src/components/ImportDialog.test.tsx
```

Expected: FAIL because `yuanluoboApi` and the “元萝卜” button do not exist.

- [ ] **Step 3: Modify ImportDialog**

In `web/src/components/ImportDialog.tsx`, import the new component:

```tsx
import { YuanluoboImportDialog, type YuanluoboImportAPI } from './YuanluoboImportDialog'
```

Update props and mode:

```tsx
interface ImportDialogProps {
  onImport(displayName: string, originalFilename: string, sgfText: string): void
  onImportUrl(url: string): void
  onCancel(): void
  yuanluoboApi: YuanluoboImportAPI
  onOpenGame(gameId: string): void | Promise<void>
}

type DialogMode = 'choose' | 'url' | 'yuanluobo'
```

Update function signature:

```tsx
export function ImportDialog({ onImport, onImportUrl, onCancel, yuanluoboApi, onOpenGame }: ImportDialogProps) {
```

Add before the URL mode render:

```tsx
if (mode === 'yuanluobo') {
  return (
    <div className="import-dialog" role="dialog" aria-label="YuanluoBo import">
      <YuanluoboImportDialog api={yuanluoboApi} onOpenGame={onOpenGame} onBack={() => setMode('choose')} />
    </div>
  )
}
```

Add button in choose mode:

```tsx
<button onClick={() => setMode('yuanluobo')}>元萝卜</button>
```

- [ ] **Step 4: Wire API adapter in App**

In `web/src/App.tsx`, import type:

```tsx
import type { YuanluoboImportAPI } from './components/YuanluoboImportDialog'
```

Create adapter inside `App` after `importFromUrl`:

```tsx
const yuanluoboApi: YuanluoboImportAPI = {
  status: () => client!.call('yuanluobo.status'),
  loginStart: () => client!.call('yuanluobo.loginStart'),
  loginPoll: (key: string) => client!.call('yuanluobo.loginPoll', { key }),
  logout: () => client!.call('yuanluobo.logout'),
  players: () => client!.call('yuanluobo.players'),
  records: (params) => client!.call('yuanluobo.records', params),
  importRecord: (sessionId: string) => client!.call('yuanluobo.importRecord', { sessionId }),
}

const openImportedGame = async (gameId: string) => {
  await refreshWorkspaceState()
  await selectGame(gameId)
  setShowImport(false)
  setGameListOpen(true)
}
```

Update render:

```tsx
{showImport && client && (
  <ImportDialog
    onImport={importGame}
    onImportUrl={importFromUrl}
    onCancel={() => setShowImport(false)}
    yuanluoboApi={yuanluoboApi}
    onOpenGame={openImportedGame}
  />
)}
```

- [ ] **Step 5: Add styles**

Append to `web/src/styles.css` near the import dialog styles:

```css
.yuanluobo-panel {
  width: min(560px, calc(100vw - 32px));
  max-height: min(720px, calc(100vh - 32px));
  display: grid;
  gap: 12px;
  padding: 20px;
  box-sizing: border-box;
  border-radius: 10px;
  background: var(--surface);
  box-shadow: var(--shadow-soft);
  overflow: auto;
}

.yuanluobo-header,
.yuanluobo-pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.yuanluobo-header button,
.yuanluobo-pager button,
.yuanluobo-panel > button {
  min-height: 34px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--surface-raised);
  color: var(--ink);
  cursor: pointer;
}

.yuanluobo-qr {
  width: 240px;
  height: 240px;
  justify-self: center;
  image-rendering: crisp-edges;
}

.yuanluobo-muted {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  text-align: center;
}

.yuanluobo-player-select {
  display: grid;
  gap: 4px;
  color: var(--muted);
  font-size: 13px;
}

.yuanluobo-player-select select {
  min-height: 36px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--surface-raised);
  color: var(--ink);
}

.yuanluobo-tabs {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.yuanluobo-tabs button {
  min-width: max-content;
  min-height: 32px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface-raised);
  color: var(--ink);
  cursor: pointer;
}

.yuanluobo-tabs button[aria-selected='true'] {
  border-color: var(--table);
  background: rgb(26 71 42 / 0.1);
  color: var(--table);
}

.yuanluobo-record-list {
  display: grid;
  gap: 8px;
}

.yuanluobo-record-row {
  min-height: 58px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px 8px;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-raised);
  color: var(--ink);
  text-align: left;
  cursor: pointer;
}

.yuanluobo-record-title,
.yuanluobo-record-meta {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.yuanluobo-record-meta {
  color: var(--muted);
  font-size: 12px;
}

.yuanluobo-imported-badge {
  grid-row: 1 / span 2;
  padding: 3px 7px;
  border: 1px solid rgb(5 150 105 / 0.24);
  border-radius: 999px;
  background: rgb(5 150 105 / 0.12);
  color: var(--table);
  font-size: 12px;
}
```

- [ ] **Step 6: Run frontend tests**

Run:

```powershell
cd web
npm test -- --run src/components/ImportDialog.test.tsx src/components/YuanluoboImportDialog.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add web/src/components/ImportDialog.tsx web/src/components/ImportDialog.test.tsx web/src/App.tsx web/src/styles.css
git commit -m "feat: wire yuanluobo import entry"
```

---

### Task 9: Full Verification and Manual Scan Check

**Files:**
- Modify only if verification finds a concrete issue in earlier tasks.

- [ ] **Step 1: Run backend tests**

Run: `go test ./...`

Expected: PASS.

- [ ] **Step 2: Run frontend tests**

Run:

```powershell
cd web
npm test -- --run
```

Expected: PASS.

- [ ] **Step 3: Build frontend**

Run:

```powershell
cd web
npm run build
```

Expected: PASS.

- [ ] **Step 4: Manual YuanluoBo scan validation**

Run the server:

```powershell
$env:JCGO_ACCESS_TOKEN='dev-token'
$env:JCGO_DATA_DIR='.data'
$env:JCGO_KATAGO_PATH='D:\Code\katrain\.venv\Lib\site-packages\katrain\KataGo\katago.exe'
$env:JCGO_MODEL_PATH='D:\Code\katrain\.venv\Lib\site-packages\katrain\models\kata1-b18c384nbt-s9996604416-d4316597426.bin.gz'
$env:JCGO_ANALYSIS_CONFIG_PATH='D:\Code\katrain\.venv\Lib\site-packages\katrain\KataGo\analysis_config.cfg'
go run ./cmd/jcgo
```

Open `http://127.0.0.1:4380`, enter `dev-token`, click the plus button, choose “元萝卜”, scan the QR code with the YuanluoBo app, and confirm:

- The UI changes from scan login to the record browser.
- Player selector has at least one player.
- Official category tabs appear.
- The first page has at most 10 records and is ordered newest first.
- Clicking an unimported record imports and opens it.
- Reopening the YuanluoBo entry marks that record as “已导入”.
- Clicking that imported record opens the same local game.
- `.data/yuanluobo_auth.json` exists after login and is removed after clicking “退出”.

- [ ] **Step 5: Final commit**

If Task 9 required fixes:

```powershell
git add -A
git commit -m "fix: complete yuanluobo import verification"
```

If Task 9 required no fixes, do not create an empty commit.

- [ ] **Step 6: Push branch**

Run: `git push origin HEAD`

Expected: PASS.
