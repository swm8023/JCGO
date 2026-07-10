# Game Worker Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a per-game analysis worker choice and make every analysis action for that game use only the selected worker.

**Architecture:** Store `analysis_worker_name` on `games`, expose it through existing workspace/game payloads, and add a small RPC to set it. Scheduler tasks carry the selected worker name, and `worker.Pool` gains targeted analysis methods that wait for the named worker when it is busy but never fall back to another worker. The frontend turns the compact analysis button into a menu that displays worker selection, progress, and actions.

**Tech Stack:** Go backend with `modernc.org/sqlite`, existing JSON-RPC handler/scheduler/worker pool, React + TypeScript + Vitest frontend.

---

## File Structure

- Modify `internal/store/repository.go`: add `GameRecord.AnalysisWorkerName`, migrate `games.analysis_worker_name`, include it in create/list/get/source scans, and add `UpdateGameAnalysisWorker`.
- Modify `internal/store/store_test.go`: add persistence and migration tests for `analysisWorkerName`.
- Modify `internal/worker/pool.go`: add named-worker acquire/analyze methods and keep existing auto-pick methods for engine status and legacy callers.
- Modify `internal/worker/pool_test.go`: add tests for named worker routing, busy waiting, unavailable error, and no fallback.
- Modify `internal/app/scheduler.go`: carry `WorkerName` through `StartInput` and `task`, then call targeted analyzer interfaces when present.
- Modify `internal/app/scheduler_test.go`: add a targeted analyzer fake and assert scheduler passes the worker name.
- Modify `internal/app/handlers.go`: add `game.setAnalysisWorker`, validate selected worker before analysis actions, and propagate worker name into start/restart/play/pass analysis.
- Modify `internal/app/handlers_test.go`: cover worker selection RPC, no-worker rejection, unavailable-worker rejection, restart and AnalyzeNow worker propagation.
- Modify `internal/app/state.go` and `internal/app/state_payload.go`: no new top-level payload is required if `games` include `analysisWorkerName`; keep state assembly compatible.
- Modify `web/src/api/types.ts`: add `analysisWorkerName` to `GameRecord`.
- Modify `web/src/components/GameSidebar.tsx`: replace direct analysis button behavior with an analysis menu.
- Modify `web/src/components/GameSidebar.test.tsx`: cover menu UI, selection, disabled states, and action calls.
- Modify `web/src/App.tsx`: compute selected game worker, call `game.setAnalysisWorker`, pass worker status/progress/menu props to `GameSidebar`.
- Modify `web/src/styles.css`: style the analysis menu and worker selector without changing unrelated page layout.

---

### Task 1: Persist Per-Game Analysis Worker

**Files:**
- Modify: `internal/store/repository.go`
- Modify: `internal/store/store_test.go`

- [ ] **Step 1: Write the failing store test**

Add this test to `internal/store/store_test.go`:

```go
func TestRepositoryStoresGameAnalysisWorkerName(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	repo, err := Open(ctx, filepath.Join(dir, "jcgo.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()

	game, err := repo.CreateGame(ctx, CreateGameInput{DisplayName: "Demo", Result: "B+R"})
	if err != nil {
		t.Fatal(err)
	}
	if game.AnalysisWorkerName != "" {
		t.Fatalf("new game analysis worker = %q", game.AnalysisWorkerName)
	}

	if err := repo.UpdateGameAnalysisWorker(ctx, game.ID, "local-gpu"); err != nil {
		t.Fatal(err)
	}
	stored, err := repo.GetGame(ctx, game.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.AnalysisWorkerName != "local-gpu" {
		t.Fatalf("stored worker = %q", stored.AnalysisWorkerName)
	}
	listed, err := repo.ListGames(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].AnalysisWorkerName != "local-gpu" {
		t.Fatalf("listed games = %#v", listed)
	}
}
```

- [ ] **Step 2: Verify the store test fails**

Run: `go test ./internal/store -run TestRepositoryStoresGameAnalysisWorkerName`

Expected: build failure mentioning `AnalysisWorkerName` or `UpdateGameAnalysisWorker` is undefined.

- [ ] **Step 3: Implement the store field and migration**

In `internal/store/repository.go`, add the field:

```go
type GameRecord struct {
	ID                 string    `json:"gameId"`
	DisplayName        string    `json:"displayName"`
	Result             string    `json:"result"`
	GameDate           string    `json:"gameDate,omitempty"`
	BlackName          string    `json:"blackName,omitempty"`
	WhiteName          string    `json:"whiteName,omitempty"`
	AnalysisWorkerName string    `json:"analysisWorkerName,omitempty"`
	SGFFilename        string    `json:"sgfFilename"`
	CreatedAt          time.Time `json:"createdAt"`
	AnalysisStatus     string    `json:"analysisStatus,omitempty"`
	SourcePlatform     string    `json:"-"`
	SourceID           string    `json:"-"`
}
```

Update `CreateGame` so the inserted record keeps the default empty worker name:

```go
game := GameRecord{
	ID:                 id,
	DisplayName:        input.DisplayName,
	Result:             input.Result,
	GameDate:           input.GameDate,
	BlackName:          input.BlackName,
	WhiteName:          input.WhiteName,
	AnalysisWorkerName: "",
	SGFFilename:        sgfFilename,
	CreatedAt:          time.Now().UTC(),
	SourcePlatform:     strings.TrimSpace(input.SourcePlatform),
	SourceID:           strings.TrimSpace(input.SourceID),
}
```

Change all `SELECT` lists that scan games to include `analysis_worker_name` between `white_name` and `sgf_filename`:

```sql
SELECT id, display_name, result, game_date, black_name, white_name, analysis_worker_name, sgf_filename, created_at, source_platform, source_id
```

Update `scanGame` to scan the new column:

```go
if err := scanner.Scan(
	&game.ID,
	&game.DisplayName,
	&game.Result,
	&game.GameDate,
	&game.BlackName,
	&game.WhiteName,
	&game.AnalysisWorkerName,
	&game.SGFFilename,
	&createdAt,
	&game.SourcePlatform,
	&game.SourceID,
); err != nil {
	return GameRecord{}, err
}
```

Add the migration line in `migrate` after the existing name columns:

```go
if err := r.ensureColumn(ctx, "analysis_worker_name", "TEXT NOT NULL DEFAULT ''"); err != nil {
	return err
}
```

Add the update method:

```go
func (r *Repository) UpdateGameAnalysisWorker(ctx context.Context, id, workerName string) error {
	workerName = strings.TrimSpace(workerName)
	result, err := r.db.ExecContext(ctx, `
		UPDATE games
		SET analysis_worker_name = ?
		WHERE id = ?
	`, workerName, id)
	if err != nil {
		return err
	}
	return requireAffected(result)
}
```

- [ ] **Step 4: Verify store tests pass**

Run: `go test ./internal/store`

Expected: PASS.

- [ ] **Step 5: Commit the store slice**

```powershell
git add internal/store/repository.go internal/store/store_test.go
git commit -m "Persist game analysis worker"
```

---

### Task 2: Add Targeted Worker Analysis to Pool

**Files:**
- Modify: `internal/worker/pool.go`
- Modify: `internal/worker/pool_test.go`

- [ ] **Step 1: Write the failing targeted-worker tests**

Add these tests to `internal/worker/pool_test.go`:

```go
func TestPoolAnalyzeWithWorkerUsesNamedWorkerOnly(t *testing.T) {
	pool := NewPool(log.New(io.Discard, "", 0))
	pool.SetConfigProvider(staticConfigProvider{config: RuntimeConfig{Model: "b28.bin.gz", MaxVisits: 900}})
	serverURL, closeServer := servePool(t, pool)
	defer closeServer()

	first := make(chan Envelope, 1)
	second := make(chan Envelope, 1)
	go runNamedFakeWorker(t, serverURL, "slow-gpu", func(conn *websocket.Conn, msg Envelope) {
		first <- msg
	})
	go runNamedFakeWorker(t, serverURL, "fast-gpu", func(conn *websocket.Conn, msg Envelope) {
		second <- msg
		_ = conn.WriteJSON(Envelope{
			Type:   MessageResult,
			ID:     msg.ID,
			Result: &katago.Result{ID: msg.Query.ID, RootInfo: katago.RootInfo{Visits: 321}},
		})
	})

	waitForWorkers(t, pool, 2)
	result, err := pool.AnalyzeWithWorker(context.Background(), "fast-gpu", katago.Query{ID: "main:4"})
	if err != nil {
		t.Fatal(err)
	}
	if result.RootInfo.Visits != 321 {
		t.Fatalf("result = %#v", result)
	}
	select {
	case msg := <-second:
		if msg.Query == nil || msg.Query.ID != "main:4" {
			t.Fatalf("fast worker message = %#v", msg)
		}
	default:
		t.Fatal("expected fast worker message")
	}
	select {
	case msg := <-first:
		t.Fatalf("unexpected slow worker message = %#v", msg)
	default:
	}
}

func TestPoolAnalyzeWithWorkerWaitsWhenNamedWorkerIsBusy(t *testing.T) {
	pool := NewPool(log.New(io.Discard, "", 0))
	serverURL, closeServer := servePool(t, pool)
	defer closeServer()

	releaseFirst := make(chan struct{})
	go runNamedFakeWorker(t, serverURL, "local-gpu", func(conn *websocket.Conn, msg Envelope) {
		<-releaseFirst
		_ = conn.WriteJSON(Envelope{Type: MessageResult, ID: msg.ID, Result: &katago.Result{ID: msg.Query.ID}})
		var next Envelope
		if err := conn.ReadJSON(&next); err != nil {
			t.Error(err)
			return
		}
		_ = conn.WriteJSON(Envelope{
			Type:   MessageResult,
			ID:     next.ID,
			Result: &katago.Result{ID: next.Query.ID, RootInfo: katago.RootInfo{Visits: 44}},
		})
	})

	waitForWorkers(t, pool, 1)
	firstDone := make(chan struct{})
	go func() {
		_, _ = pool.AnalyzeWithWorker(context.Background(), "local-gpu", katago.Query{ID: "main:1"})
		close(firstDone)
	}()
	time.Sleep(30 * time.Millisecond)

	secondDone := make(chan katago.Result, 1)
	go func() {
		result, err := pool.AnalyzeWithWorker(context.Background(), "local-gpu", katago.Query{ID: "main:2"})
		if err != nil {
			t.Error(err)
			return
		}
		secondDone <- result
	}()

	select {
	case result := <-secondDone:
		t.Fatalf("second finished before busy worker released: %#v", result)
	case <-time.After(40 * time.Millisecond):
	}
	close(releaseFirst)
	<-firstDone
	result := <-secondDone
	if result.RootInfo.Visits != 44 {
		t.Fatalf("second result = %#v", result)
	}
}

func TestPoolAnalyzeWithWorkerRejectsUnavailableWorkerWithoutFallback(t *testing.T) {
	pool := NewPool(log.New(io.Discard, "", 0))
	pool.addWorker(&remoteWorker{
		id:        "worker-1",
		info:      Info{Name: "bad-gpu", Error: "katago missing"},
		responses: map[string]chan Envelope{},
	})
	pool.addWorker(&remoteWorker{
		id:        "worker-2",
		info:      Info{Name: "good-gpu"},
		responses: map[string]chan Envelope{},
	})

	_, err := pool.AnalyzeWithWorker(context.Background(), "bad-gpu", katago.Query{ID: "main:0"})
	if err == nil || !strings.Contains(err.Error(), "bad-gpu is unavailable") {
		t.Fatalf("err = %v", err)
	}
}
```

Add this helper near `runFakeWorker`:

```go
func runNamedFakeWorker(t *testing.T, url string, name string, handle func(*websocket.Conn, Envelope)) {
	t.Helper()
	dialer := websocket.Dialer{Subprotocols: []string{Subprotocol}}
	conn, _, err := dialer.Dial(url, nil)
	if err != nil {
		t.Error(err)
		return
	}
	defer conn.Close()
	if err := conn.WriteJSON(Envelope{
		Type:   MessageRegister,
		Worker: &Info{Name: name, Platform: "windows/amd64", Backend: "opencl"},
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
```

- [ ] **Step 2: Verify targeted-worker tests fail**

Run: `go test ./internal/worker -run "TestPoolAnalyzeWithWorker"`

Expected: build failure for undefined `AnalyzeWithWorker`.

- [ ] **Step 3: Implement named worker acquire and analyze methods**

In `internal/worker/pool.go`, add:

```go
func (p *Pool) AnalyzeWithWorker(ctx context.Context, workerName string, query katago.Query) (katago.Result, error) {
	return p.AnalyzeWithWorkerProgress(ctx, workerName, query, nil)
}

func (p *Pool) AnalyzeWithWorkerProgress(ctx context.Context, workerName string, query katago.Query, progress func(katago.Result)) (katago.Result, error) {
	worker, err := p.acquireNamedWorker(ctx, workerName)
	if err != nil {
		return katago.Result{}, err
	}
	cfg, err := p.runtimeConfig(ctx, worker.info.Name)
	if err != nil {
		p.releaseWorker(worker)
		return katago.Result{}, err
	}
	result, err := p.analyzeRemote(ctx, worker, query, cfg, progress)
	p.releaseWorker(worker)
	if err == nil {
		return result, nil
	}
	p.logger.Printf("worker pool: named worker %s failed query %s: %v", worker.info.Name, query.ID, err)
	return katago.Result{}, err
}

func (p *Pool) acquireNamedWorker(ctx context.Context, workerName string) (*remoteWorker, error) {
	workerName = strings.TrimSpace(workerName)
	if workerName == "" {
		return nil, errors.New("worker name is required")
	}
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	for {
		p.mu.Lock()
		worker, err := p.namedWorkerLocked(workerName)
		if err != nil {
			p.mu.Unlock()
			return nil, err
		}
		if !worker.busy {
			worker.busy = true
			p.mu.Unlock()
			return worker, nil
		}
		p.mu.Unlock()

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-ticker.C:
		}
	}
}

func (p *Pool) namedWorkerLocked(workerName string) (*remoteWorker, error) {
	for _, worker := range p.ws {
		if worker.closed || worker.info.Name != workerName {
			continue
		}
		if !workerAvailable(worker.info) {
			if worker.info.Error != "" {
				return nil, fmt.Errorf("worker %s is unavailable: %s", workerName, worker.info.Error)
			}
			return nil, fmt.Errorf("worker %s is unavailable", workerName)
		}
		return worker, nil
	}
	return nil, fmt.Errorf("worker %s is not connected", workerName)
}
```

- [ ] **Step 4: Verify worker package passes**

Run: `go test ./internal/worker`

Expected: PASS.

- [ ] **Step 5: Commit the worker pool slice**

```powershell
git add internal/worker/pool.go internal/worker/pool_test.go
git commit -m "Route analysis to named workers"
```

---

### Task 3: Carry Worker Name Through Scheduler

**Files:**
- Modify: `internal/app/scheduler.go`
- Modify: `internal/app/scheduler_test.go`

- [ ] **Step 1: Write the failing scheduler test**

Add this fake and test to `internal/app/scheduler_test.go`:

```go
type fakeWorkerBoundAnalyzer struct {
	fakeAnalyzer
	workerNames []string
}

func (f *fakeWorkerBoundAnalyzer) AnalyzeWithWorkerProgress(ctx context.Context, workerName string, query katago.Query, progress func(katago.Result)) (katago.Result, error) {
	f.workerNames = append(f.workerNames, workerName)
	return f.fakeAnalyzer.Analyze(ctx, query)
}

func TestSchedulerUsesStartInputWorkerName(t *testing.T) {
	engine := &fakeWorkerBoundAnalyzer{}
	scheduler := NewScheduler(engine)
	defer scheduler.Close()

	received := make(chan Event, 1)
	scheduler.Subscribe(func(event Event) { received <- event })
	scheduler.StartGame(StartInput{
		Token:       "secret",
		GameID:      "game-1",
		WorkerName:  "local-gpu",
		FocusNodeID: "main:0",
		Nodes: []NodeInput{
			{NodeID: "main:0", MoveNumber: 0, ToPlay: game.Black, Rules: "chinese", Komi: 7.5},
		},
	})
	_ = waitSchedulerEvent(t, received)

	if len(engine.workerNames) != 1 || engine.workerNames[0] != "local-gpu" {
		t.Fatalf("worker names = %#v", engine.workerNames)
	}
}
```

- [ ] **Step 2: Verify scheduler test fails**

Run: `go test ./internal/app -run TestSchedulerUsesStartInputWorkerName`

Expected: build failure for unknown `WorkerName`.

- [ ] **Step 3: Add worker name to scheduler input and task**

In `internal/app/scheduler.go`, update structs:

```go
type StartInput struct {
	Token       string
	GameID      string
	WorkerName  string
	FocusNodeID string
	Nodes       []NodeInput
}

type task struct {
	token      string
	gameID     string
	workerName string
	node       NodeInput
}
```

Update enqueue code:

```go
s.enqueue(task{token: input.Token, gameID: input.GameID, workerName: input.WorkerName, node: node})
```

Add local targeted interfaces near `Scheduler`:

```go
type workerProgressAnalyzer interface {
	AnalyzeWithWorkerProgress(context.Context, string, katago.Query, func(katago.Result)) (katago.Result, error)
}

type workerAnalyzer interface {
	AnalyzeWithWorker(context.Context, string, katago.Query) (katago.Result, error)
}
```

Update `analyze`:

```go
func (s *Scheduler) analyze(ctx context.Context, task task, query katago.Query) (katago.Result, error) {
	if task.workerName != "" {
		if engine, ok := s.engine.(workerProgressAnalyzer); ok {
			return engine.AnalyzeWithWorkerProgress(ctx, task.workerName, query, func(result katago.Result) {
				if s.isStopped(task.token, task.gameID) {
					return
				}
				s.publishAnalysis(task, result)
			})
		}
		if engine, ok := s.engine.(workerAnalyzer); ok {
			return engine.AnalyzeWithWorker(ctx, task.workerName, query)
		}
	}
	if engine, ok := s.engine.(katago.ProgressAnalyzer); ok {
		return engine.AnalyzeWithProgress(ctx, query, func(result katago.Result) {
			if s.isStopped(task.token, task.gameID) {
				return
			}
			s.publishAnalysis(task, result)
		})
	}
	return s.engine.Analyze(ctx, query)
}
```

- [ ] **Step 4: Verify scheduler tests pass**

Run: `go test ./internal/app -run "TestScheduler"`

Expected: PASS.

- [ ] **Step 5: Commit the scheduler slice**

```powershell
git add internal/app/scheduler.go internal/app/scheduler_test.go
git commit -m "Carry analysis worker through scheduler"
```

---

### Task 4: Add Game Worker RPC and Analysis Validation

**Files:**
- Modify: `internal/app/handlers.go`
- Modify: `internal/app/handlers_test.go`

- [ ] **Step 1: Write failing handler tests for selection and start validation**

Add these tests to `internal/app/handlers_test.go`:

```go
func TestGameSetAnalysisWorkerPersistsSelection(t *testing.T) {
	h, token := newTestHandler(t)
	imported := callResult[ImportResult](t, h, token, "game.importSgf", map[string]any{
		"displayName": "Demo",
		"sgfText":     "(;GM[1]FF[4]SZ[19];B[pd])",
	})

	state := callResult[StatePayload](t, h, token, "game.setAnalysisWorker", map[string]any{
		"gameId":     imported.Game.ID,
		"workerName": "local-gpu",
	})

	stored, err := h.repo.GetGame(context.Background(), imported.Game.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.AnalysisWorkerName != "local-gpu" {
		t.Fatalf("stored worker = %q", stored.AnalysisWorkerName)
	}
	if len(state.Games) != 1 || state.Games[0].AnalysisWorkerName != "local-gpu" {
		t.Fatalf("state games = %#v", state.Games)
	}
}

func TestAnalysisStartRequiresSelectedWorker(t *testing.T) {
	h, token := newTestHandler(t)
	imported := callResult[ImportResult](t, h, token, "game.importSgf", map[string]any{
		"displayName": "Demo",
		"sgfText":     "(;GM[1]FF[4]SZ[19];B[pd])",
	})

	_, err := h.Call(context.Background(), token, "analysis.start", mustJSON(t, map[string]any{"gameId": imported.Game.ID}))
	if err == nil || !strings.Contains(err.Error(), "analysis worker is required") {
		t.Fatalf("err = %v", err)
	}
}

func TestAnalysisStartRejectsUnavailableSelectedWorker(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	repo, err := store.Open(ctx, filepath.Join(dir, "jcgo.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	handler := NewHandlerWithOptions(repo, store.NewFileStore(filepath.Join(dir, "games")), NewWorkspaceStore(), &recordingAnalysisController{}, HandlerOptions{
		WorkerStatusProvider: fakeWorkerStatusProvider{status: worker.StatusSnapshot{
			Connected: 1,
			Workers: []worker.RuntimeStatus{{
				ID:        "worker-1",
				Name:      "local-gpu",
				Available: false,
				Error:     "katago missing",
			}},
		}},
	})
	imported := callResult[ImportResult](t, handler, "secret", "game.importSgf", map[string]any{
		"displayName": "Demo",
		"sgfText":     "(;GM[1]FF[4]SZ[19];B[pd])",
	})
	if err := repo.UpdateGameAnalysisWorker(ctx, imported.Game.ID, "local-gpu"); err != nil {
		t.Fatal(err)
	}

	_, err = handler.Call(ctx, "secret", "analysis.start", mustJSON(t, map[string]any{"gameId": imported.Game.ID}))
	if err == nil || !strings.Contains(err.Error(), "local-gpu is unavailable") {
		t.Fatalf("err = %v", err)
	}
}
```

Add this helper near `callResult`:

```go
func mustJSON(t *testing.T, params map[string]any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(params)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
```

- [ ] **Step 2: Verify handler tests fail**

Run: `go test ./internal/app -run "TestGameSetAnalysisWorkerPersistsSelection|TestAnalysisStartRequiresSelectedWorker|TestAnalysisStartRejectsUnavailableSelectedWorker"`

Expected: failures for missing method and missing validation.

- [ ] **Step 3: Implement RPC and validation helpers**

In `internal/app/handlers.go`, add the method dispatch:

```go
case "game.setAnalysisWorker":
	return h.setGameAnalysisWorker(ctx, token, params)
```

Add params:

```go
type gameAnalysisWorkerParams struct {
	GameID     string `json:"gameId"`
	WorkerName string `json:"workerName"`
}
```

Add the handler:

```go
func (h *Handler) setGameAnalysisWorker(ctx context.Context, token string, params json.RawMessage) (any, error) {
	var in gameAnalysisWorkerParams
	if err := decodeParams(params, &in); err != nil {
		return nil, err
	}
	workerName := strings.TrimSpace(in.WorkerName)
	if strings.TrimSpace(in.GameID) == "" {
		return nil, errors.New("gameId is required")
	}
	if workerName == "" {
		return nil, errors.New("workerName is required")
	}
	if _, err := h.repo.GetGame(ctx, in.GameID); err != nil {
		return nil, err
	}
	if err := h.repo.UpdateGameAnalysisWorker(ctx, in.GameID, workerName); err != nil {
		return nil, err
	}
	return h.workspaceState(ctx, token)
}
```

Add worker validation:

```go
func (h *Handler) requireGameAnalysisWorker(ctx context.Context, gameID string) (string, error) {
	record, err := h.repo.GetGame(ctx, gameID)
	if err != nil {
		return "", err
	}
	workerName := strings.TrimSpace(record.AnalysisWorkerName)
	if workerName == "" {
		return "", errors.New("analysis worker is required")
	}
	if err := h.requireWorkerReady(workerName); err != nil {
		return "", err
	}
	return workerName, nil
}

func (h *Handler) requireWorkerReady(workerName string) error {
	if h.workerStatus == nil {
		return fmt.Errorf("worker %s is not connected", workerName)
	}
	status := h.workerStatus.StatusSnapshot()
	for _, candidate := range status.Workers {
		if candidate.Name != workerName {
			continue
		}
		if candidate.Error != "" {
			return fmt.Errorf("worker %s is unavailable: %s", workerName, candidate.Error)
		}
		if !candidate.Available {
			return fmt.Errorf("worker %s is unavailable", workerName)
		}
		return nil
	}
	return fmt.Errorf("worker %s is not connected", workerName)
}
```

Add `fmt` to the imports.

- [ ] **Step 4: Use validation in analysis start/restart**

In `analysisCall`, call validation before marking running:

```go
workerName, err := h.requireGameAnalysisWorker(ctx, in.GameID)
if err != nil {
	return nil, err
}
input := StartInput{
	Token:       token,
	GameID:      in.GameID,
	WorkerName:  workerName,
	FocusNodeID: snapshot.NodeID,
	Nodes:       ws.MissingMainlineAnalysisInputs(in.GameID),
}
```

- [ ] **Step 5: Verify handler tests pass**

Run: `go test ./internal/app -run "TestGameSetAnalysisWorkerPersistsSelection|TestAnalysisStartRequiresSelectedWorker|TestAnalysisStartRejectsUnavailableSelectedWorker"`

Expected: PASS.

- [ ] **Step 6: Commit the handler validation slice**

```powershell
git add internal/app/handlers.go internal/app/handlers_test.go
git commit -m "Require selected worker for analysis"
```

---

### Task 5: Propagate Worker Name Through Restart and AnalyzeNow

**Files:**
- Modify: `internal/app/handlers.go`
- Modify: `internal/app/handlers_test.go`

- [ ] **Step 1: Write failing tests for restart and play propagation**

Add these tests to `internal/app/handlers_test.go`:

```go
func TestAnalysisRestartPassesSelectedWorker(t *testing.T) {
	h, token := newTestHandlerWithWorker(t, "local-gpu")
	imported := callResult[ImportResult](t, h, token, "game.importSgf", map[string]any{
		"displayName": "Demo",
		"sgfText":     "(;GM[1]FF[4]SZ[19];B[pd];W[dd])",
	})
	if err := h.repo.UpdateGameAnalysisWorker(context.Background(), imported.Game.ID, "local-gpu"); err != nil {
		t.Fatal(err)
	}
	recorder := &recordingAnalysisController{}
	h.analysis = recorder

	_ = callResult[StatePayload](t, h, token, "analysis.restart", map[string]any{"gameId": imported.Game.ID})
	if len(recorder.restarted) != 1 || recorder.restarted[0].WorkerName != "local-gpu" {
		t.Fatalf("restarted = %#v", recorder.restarted)
	}
}

func TestPlayQueuesCurrentNodeWithSelectedWorker(t *testing.T) {
	h, token := newTestHandlerWithWorker(t, "local-gpu")
	imported := callResult[ImportResult](t, h, token, "game.importSgf", map[string]any{
		"displayName": "Demo",
		"sgfText":     "(;GM[1]FF[4]SZ[19];B[pd])",
	})
	if err := h.repo.UpdateGameAnalysisWorker(context.Background(), imported.Game.ID, "local-gpu"); err != nil {
		t.Fatal(err)
	}
	recorder := &recordingAnalysisController{}
	h.analysis = recorder

	_ = callResult[StatePayload](t, h, token, "game.play", map[string]any{"gameId": imported.Game.ID, "move": "D4"})
	if len(recorder.started) != 1 || recorder.started[0].WorkerName != "local-gpu" {
		t.Fatalf("started = %#v", recorder.started)
	}
}
```

Add helper:

```go
func newTestHandlerWithWorker(t *testing.T, workerName string) (*Handler, string) {
	t.Helper()
	ctx := context.Background()
	dir := t.TempDir()
	repo, err := store.Open(ctx, filepath.Join(dir, "jcgo.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = repo.Close() })
	status := worker.StatusSnapshot{
		Connected: 1,
		Available: 1,
		Workers: []worker.RuntimeStatus{{
			ID:        "worker-1",
			Name:      workerName,
			Available: true,
		}},
	}
	return NewHandlerWithOptions(repo, store.NewFileStore(filepath.Join(dir, "games")), NewWorkspaceStore(), nil, HandlerOptions{
		WorkerStatusProvider: fakeWorkerStatusProvider{status: status},
	}), "secret"
}
```

- [ ] **Step 2: Verify propagation tests fail**

Run: `go test ./internal/app -run "TestAnalysisRestartPassesSelectedWorker|TestPlayQueuesCurrentNodeWithSelectedWorker"`

Expected: failures showing empty `WorkerName`.

- [ ] **Step 3: Pass worker name into AnalyzeNow**

Change `play` and `pass` to call:

```go
h.analyzeCurrentNode(ctx, token, ws, in.GameID, snapshot.NodeID)
```

Change the helper signature and implementation:

```go
func (h *Handler) analyzeCurrentNode(ctx context.Context, token string, ws *Workspace, gameID string, nodeID string) {
	if h.analysis == nil {
		return
	}
	workerName, err := h.requireGameAnalysisWorker(ctx, gameID)
	if err != nil {
		ws.SetAnalysisError(gameID, err.Error())
		return
	}
	input, ok := ws.CurrentAnalysisInput(gameID)
	if !ok || input.NodeID != nodeID {
		return
	}
	h.analysis.AnalyzeNow(StartInput{
		Token:       token,
		GameID:      gameID,
		WorkerName:  workerName,
		FocusNodeID: nodeID,
		Nodes:       []NodeInput{input},
	})
}
```

- [ ] **Step 4: Ensure restart uses selected worker after clearing**

Keep `workerName` computed before the switch and preserve it when replacing `input` values inside `restart`:

```go
input.FocusNodeID = snapshot.NodeID
input.Nodes = ws.MainlineAnalysisInputs(in.GameID)
input.WorkerName = workerName
```

- [ ] **Step 5: Verify app tests pass**

Run: `go test ./internal/app`

Expected: PASS.

- [ ] **Step 6: Commit propagation slice**

```powershell
git add internal/app/handlers.go internal/app/handlers_test.go
git commit -m "Use selected worker for game analysis tasks"
```

---

### Task 6: Update Frontend Types and App Wiring

**Files:**
- Modify: `web/src/api/types.ts`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Add frontend type field**

In `web/src/api/types.ts`, add:

```ts
export interface GameRecord {
  gameId: string
  displayName: string
  result: string
  gameDate?: string
  blackName?: string
  whiteName?: string
  analysisWorkerName?: string
  sgfFilename: string
  createdAt: string
  analysisStatus?: AnalysisState
}
```

- [ ] **Step 2: Add App wiring for game worker selection**

In `web/src/App.tsx`, add this handler near `configureWorker`:

```ts
const setGameAnalysisWorker = async (workerName: string) => {
  if (!client || !selectedGameId) return
  const state = await client.call<StatePayload>('game.setAnalysisWorker', { gameId: selectedGameId, workerName })
  applyWorkspaceState(state)
}
```

Add selected game derivation before `return`:

```ts
const selectedGame = games.find((game) => game.gameId === selectedGameId)
```

Pass these props to `GameSidebar`:

```tsx
selectedAnalysisWorkerName={selectedGame?.analysisWorkerName}
workerStatus={workspace?.workerStatus}
onSetAnalysisWorker={setGameAnalysisWorker}
```

- [ ] **Step 3: Verify TypeScript fails until sidebar props exist**

Run: `npm run build`

Expected: TypeScript errors on `GameSidebar` props.

- [ ] **Step 4: Commit only after Task 7 compiles**

Do not commit this task alone. The build is intentionally broken until `GameSidebar` accepts the new props in Task 7.

---

### Task 7: Replace Analysis Button With Menu

**Files:**
- Modify: `web/src/components/GameSidebar.tsx`
- Modify: `web/src/components/GameSidebar.test.tsx`
- Modify: `web/src/styles.css`

- [ ] **Step 1: Write failing menu tests**

In `web/src/components/GameSidebar.test.tsx`, replace the old direct-start analysis action test with:

```tsx
it('opens an analysis menu with worker selection and actions', async () => {
  const user = userEvent.setup()
  const onSetAnalysisWorker = vi.fn().mockResolvedValue(undefined)
  const onStartAnalysis = vi.fn()
  const onRestartAnalysis = vi.fn()
  render(
    <GameSidebar
      games={[]}
      listOpen={false}
      selectedGameId="game-1"
      selectedAnalysisWorkerName="local-gpu"
      workerStatus={{
        connected: 1,
        available: 1,
        busy: 0,
        workers: [{
          id: 'worker-1',
          name: 'local-gpu',
          platform: 'windows/amd64',
          model: 'kata1-b18c384nbt-s9996604416-d4316597426.bin.gz',
          maxVisits: 500,
          available: true,
          busy: false,
        }],
      }}
      analysisAvailable
      analysisState="idle"
      analysisProgress={{ analyzed: 3, total: 10 }}
      onToggleList={vi.fn()}
      onImport={vi.fn()}
      onSelect={vi.fn()}
      onDelete={vi.fn()}
      onStartAnalysis={onStartAnalysis}
      onStopAnalysis={vi.fn()}
      onRestartAnalysis={onRestartAnalysis}
      onSetAnalysisWorker={onSetAnalysisWorker}
    />,
  )

  await user.click(screen.getByRole('button', { name: '打开分析菜单' }))
  const menu = screen.getByRole('menu', { name: '分析' })
  expect(within(menu).getByText('3 / 10')).toBeInTheDocument()
  expect(within(menu).getByLabelText('分析器')).toHaveValue('local-gpu')
  await user.click(within(menu).getByRole('menuitem', { name: '继续分析' }))
  expect(onStartAnalysis).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: '打开分析菜单' }))
  await user.click(within(screen.getByRole('menu', { name: '分析' })).getByRole('menuitem', { name: '重新分析' }))
  expect(onRestartAnalysis).toHaveBeenCalledTimes(1)
})
```

Add this test:

```tsx
it('requires a worker before analysis actions are enabled', async () => {
  const user = userEvent.setup()
  render(
    <GameSidebar
      games={[]}
      listOpen={false}
      selectedGameId="game-1"
      workerStatus={{ connected: 0, available: 0, busy: 0, workers: [] }}
      analysisAvailable
      analysisState="idle"
      onToggleList={vi.fn()}
      onImport={vi.fn()}
      onSelect={vi.fn()}
      onDelete={vi.fn()}
      onStartAnalysis={vi.fn()}
      onStopAnalysis={vi.fn()}
      onRestartAnalysis={vi.fn()}
      onSetAnalysisWorker={vi.fn()}
    />,
  )

  await user.click(screen.getByRole('button', { name: '打开分析菜单' }))
  const menu = screen.getByRole('menu', { name: '分析' })
  expect(within(menu).getByRole('menuitem', { name: '继续分析' })).toBeDisabled()
  expect(within(menu).getByRole('menuitem', { name: '重新分析' })).toBeDisabled()
  expect(within(menu).getByText('请选择分析器')).toBeInTheDocument()
})
```

Add `userEvent` import:

```ts
import userEvent from '@testing-library/user-event'
```

- [ ] **Step 2: Verify frontend tests fail**

Run: `npm test -- --run GameSidebar`

Expected: failures because the menu does not exist.

- [ ] **Step 3: Implement `GameSidebar` props**

In `web/src/components/GameSidebar.tsx`, update imports:

```ts
import { ChevronDown, Menu, Plus, Settings, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AnalysisProgress, AnalysisState, GameRecord, WorkerStatus } from '../api/types'
```

Add props:

```ts
  selectedAnalysisWorkerName?: string
  workerStatus?: WorkerStatus
  onSetAnalysisWorker?(workerName: string): Promise<void>
```

Update the `GameSidebar` function parameter destructuring so it includes the existing stop/restart handlers and the new menu props:

```ts
export function GameSidebar({
  games,
  listOpen,
  selectedGameId,
  selectedAnalysisWorkerName,
  workerStatus,
  analysisAvailable,
  analysisError,
  analysisState,
  analysisProgress,
  onToggleList,
  onImport,
  onSettings = noop,
  onSelect,
  onDelete,
  onStartAnalysis,
  onStopAnalysis,
  onRestartAnalysis,
  onSetAnalysisWorker,
  toolbarSlot,
}: GameSidebarProps) {
```

Remove the old local variables that only supported the single direct analysis button:

```ts
const analysisAction = analysisButton(analysisState, analysisProgress, onStartAnalysis)
const disabled = !selectedGameId || analysisAction.disabled || (!analysisAvailable && analysisState !== 'running')
const analysisClassName = analysisAction.wide ? 'analysis-action-button analysis-action-wide' : 'analysis-action-button'
```

Replace the old analysis button block with an `AnalysisMenu` component call:

```tsx
<AnalysisMenu
  selectedGameId={selectedGameId}
  selectedWorkerName={selectedAnalysisWorkerName}
  workerStatus={workerStatus}
  analysisAvailable={analysisAvailable}
  analysisError={analysisError}
  analysisState={analysisState}
  analysisProgress={analysisProgress}
  onSetAnalysisWorker={onSetAnalysisWorker}
  onStartAnalysis={onStartAnalysis}
  onStopAnalysis={onStopAnalysis}
  onRestartAnalysis={onRestartAnalysis}
/>
```

Add this component below `GameSidebar`:

```tsx
function AnalysisMenu({
  selectedGameId,
  selectedWorkerName,
  workerStatus,
  analysisAvailable,
  analysisError,
  analysisState,
  analysisProgress,
  onSetAnalysisWorker,
  onStartAnalysis,
  onStopAnalysis,
  onRestartAnalysis,
}: {
  selectedGameId?: string
  selectedWorkerName?: string
  workerStatus?: WorkerStatus
  analysisAvailable: boolean
  analysisError?: string
  analysisState: AnalysisState
  analysisProgress?: AnalysisProgress
  onSetAnalysisWorker?(workerName: string): Promise<void>
  onStartAnalysis(): void
  onStopAnalysis(): void
  onRestartAnalysis(): void
}) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const running = analysisState === 'running'
  const workers = workerStatus?.workers ?? []
  const selectedWorker = workers.find((worker) => worker.name === selectedWorkerName)
  const workerReady = Boolean(selectedWorkerName && selectedWorker?.available && !selectedWorker.error)
  const actionDisabled = !selectedGameId || !workerReady || (!analysisAvailable && !running)
  const progress = formatAnalysisProgressSpaced(analysisProgress)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const setWorker = async (workerName: string) => {
    if (!onSetAnalysisWorker || running || workerName === selectedWorkerName) return
    await onSetAnalysisWorker(workerName)
  }

  return (
    <div className="analysis-menu-root" ref={menuRef}>
      <button className="analysis-action-button" aria-label="打开分析菜单" aria-expanded={open} onClick={() => setOpen((value) => !value)} disabled={!selectedGameId}>
        <span className="wide-label">{running ? formatAnalysisProgress(analysisProgress) : '析'}</span>
        <span className="narrow-label">{running ? formatAnalysisProgress(analysisProgress) : '析'}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div className="analysis-menu" role="menu" aria-label="分析">
          <label className="analysis-worker-select">
            <span>分析器</span>
            <select value={selectedWorkerName || ''} disabled={running || !onSetAnalysisWorker} onChange={(event) => void setWorker(event.target.value)}>
              <option value="">请选择分析器</option>
              {workers.map((worker) => (
                <option key={worker.name || worker.id} value={worker.name}>{worker.name || worker.id}</option>
              ))}
            </select>
          </label>
          <div className="analysis-menu-status">
            <strong>{analysisStatusLabel(analysisState)}</strong>
            <span>{progress}</span>
          </div>
          {!selectedWorkerName && <small className="engine-error">请选择分析器</small>}
          {selectedWorkerName && !workerReady && <small className="engine-error">{selectedWorker?.error || '分析器不可用'}</small>}
          {analysisError && <small className="engine-error">{analysisError}</small>}
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onStartAnalysis() }} disabled={actionDisabled || running}>继续分析</button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onRestartAnalysis() }} disabled={actionDisabled || running}>重新分析</button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onStopAnalysis() }} disabled={!running}>停止分析</button>
        </div>
      )}
    </div>
  )
}
```

Add helper:

```tsx
function formatAnalysisProgressSpaced(progress?: AnalysisProgress) {
  if (!progress) return '0 / 0'
  return `${progress.analyzed} / ${progress.total}`
}
```

- [ ] **Step 4: Add menu CSS**

In `web/src/styles.css`, add near `.sidebar-analysis`:

```css
.analysis-menu-root {
  position: relative;
  display: grid;
  place-items: center;
}

.analysis-menu {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 30;
  width: 230px;
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  box-shadow: 0 10px 24px rgb(26 26 46 / 0.14);
}

.analysis-worker-select {
  display: grid;
  gap: 5px;
  font-size: 11px;
  color: var(--muted);
}

.analysis-worker-select select {
  min-width: 0;
  height: 30px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
}

.analysis-menu-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}

.analysis-menu button[role='menuitem'] {
  height: 30px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
}

.analysis-menu button[role='menuitem']:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}
```

- [ ] **Step 5: Verify frontend test passes**

Run: `npm test -- --run GameSidebar`

Expected: PASS.

- [ ] **Step 6: Verify frontend build passes**

Run: `npm run build`

Expected: PASS with the existing Vite chunk-size warning allowed.

- [ ] **Step 7: Commit frontend menu slice**

```powershell
git add web/src/api/types.ts web/src/App.tsx web/src/components/GameSidebar.tsx web/src/components/GameSidebar.test.tsx web/src/styles.css
git commit -m "Add per-game analysis menu"
```

---

### Task 8: Update Existing Tests for Required Worker Selection

**Files:**
- Modify: `internal/app/handlers_test.go`

- [ ] **Step 1: Run full app tests to find legacy assumptions**

Run: `go test ./internal/app`

Expected: failures in tests that call `analysis.start`, `analysis.restart`, `game.play`, or `game.pass` without selecting a worker.

- [ ] **Step 2: Update tests that should analyze successfully**

For each test that expects analysis to run, create the handler with a worker and set the selected game worker before calling analysis. Use this pattern:

```go
h, token := newTestHandlerWithWorker(t, "local-gpu")
imported := callResult[ImportResult](t, h, token, "game.importSgf", map[string]any{
	"displayName": "Demo",
	"sgfText":     "(;GM[1]FF[4]SZ[19];B[pd])",
})
if err := h.repo.UpdateGameAnalysisWorker(context.Background(), imported.Game.ID, "local-gpu"); err != nil {
	t.Fatal(err)
}
```

For tests that construct `NewHandler` manually, switch to `NewHandlerWithOptions` and pass:

```go
HandlerOptions{
	WorkerStatusProvider: fakeWorkerStatusProvider{status: worker.StatusSnapshot{
		Connected: 1,
		Available: 1,
		Workers: []worker.RuntimeStatus{{
			ID:        "worker-1",
			Name:      "local-gpu",
			Available: true,
		}},
	}},
}
```

- [ ] **Step 3: Keep one explicit rejection test**

Keep `TestAnalysisStartRequiresSelectedWorker` as the single test asserting no-worker rejection. Do not weaken handler validation to make old tests pass.

- [ ] **Step 4: Verify app package passes**

Run: `go test ./internal/app`

Expected: PASS.

- [ ] **Step 5: Commit test updates**

```powershell
git add internal/app/handlers_test.go
git commit -m "Update analysis tests for selected workers"
```

---

### Task 9: Full Verification and Windows Deploy

**Files:**
- No planned source edits. Use this task for verification and deployment only.

- [ ] **Step 1: Run backend tests**

Run: `go test ./...`

Expected: all packages PASS.

- [ ] **Step 2: Run frontend tests**

Run from `web`: `npm test -- --run`

Expected: all Vitest files PASS. The existing `--localstorage-file` warning is acceptable if tests pass.

- [ ] **Step 3: Run frontend build**

Run from `web`: `npm run build`

Expected: TypeScript and Vite build PASS. The existing Vite chunk-size warning is acceptable.

- [ ] **Step 4: Run deploy**

Run from repo root:

```powershell
$env:JCGO_DEPLOY_NO_PAUSE='1'
.\deploy.bat
```

Expected: deploy completes with `[OK] deploy complete`.

- [ ] **Step 5: Start deployed runtime**

Run:

```powershell
$env:JCGO_RUNTIME_NO_PAUSE='1'
& "$HOME\.jcgo\start.bat"
```

Expected: start script reports `started jcgo.exe` and `started jcgo-worker.exe`, then `[OK] start complete`.

- [ ] **Step 6: Confirm runtime processes**

Run:

```powershell
Get-Process jcgo,jcgo-worker,katago -ErrorAction SilentlyContinue | Select-Object ProcessName,Id,Path
```

Expected: `jcgo.exe` and `jcgo-worker.exe` are listed. `katago.exe` should be listed after the worker starts KataGo.

- [ ] **Step 7: Final commit and push if earlier commits were not pushed**

Run:

```powershell
git status --short --branch
git push origin master
```

Expected: branch pushes successfully to `origin/master`. If any task commits remain local, push them before final response.
