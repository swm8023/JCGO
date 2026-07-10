# Analysis Scheduler UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single global analysis queue with per-worker lane scheduling and show all lane state inside the `析` menu.

**Architecture:** The backend scheduler owns authoritative queue state. It groups background analysis as whole-game runs in per-worker normal queues, puts trial/current-node analysis into per-worker high-priority queues, and exposes a JSON snapshot through workspace state. The React sidebar renders that snapshot in the existing analysis menu and sends a new boost RPC for queued whole-game runs.

**Tech Stack:** Go scheduler/handler tests, existing worker pool RPC, React + TypeScript, Vitest, existing CSS.

---

## File Structure

- Modify `internal/app/scheduler.go`: replace the single `tasks` consumer with worker lane queues, background game runs, high-priority single-node tasks, boost support, stop semantics, and scheduler snapshots.
- Modify `internal/app/scheduler_test.go`: add tests for per-worker parallelism, same-worker serial execution, high-priority trial tasks, manual boost, and stop-current-game behavior.
- Modify `internal/app/handlers.go`: extend `AnalysisController`, pass display names into `StartInput`, expose `analysis.boost`, and include scheduler snapshot in state.
- Modify `internal/app/state.go`: attach scheduler snapshot to empty and selected workspace state payloads.
- Modify `internal/app/state_payload.go`: add `AnalysisSchedule` to `StatePayload` and define JSON payload structs if they are not placed in `scheduler.go`.
- Modify `internal/app/handlers_test.go`: test `workspace.state` schedule payload and `analysis.boost`.
- Modify `web/src/api/types.ts`: add schedule/lane/task TypeScript interfaces and `analysisSchedule?: AnalysisSchedule` on `StatePayload`.
- Modify `web/src/App.tsx`: pass schedule into `GameSidebar` and add `boostAnalysis` RPC handler.
- Modify `web/src/components/GameSidebar.tsx`: render all worker lanes in the existing analysis menu, set the analysis button title to current-game progress, and call boost for queued whole-game tasks.
- Modify `web/src/components/GameSidebar.test.tsx`: cover menu lane rendering, boost button behavior, and lightweight game-list status.
- Modify `web/src/styles.css`: style the lane list inside `析` menu without adding a separate task page.

---

### Task 1: Scheduler Snapshot Types and Baseline Tests

**Files:**
- Modify: `internal/app/scheduler.go`
- Modify: `internal/app/scheduler_test.go`

- [ ] **Step 1: Write failing snapshot test**

Add this test to `internal/app/scheduler_test.go` near existing scheduler tests:

```go
func TestSchedulerSnapshotShowsQueuedBackgroundRunsByWorker(t *testing.T) {
	engine := &blockingWorkerAnalyzer{
		started: make(chan workerStart, 4),
		release: make(chan struct{}),
	}
	scheduler := NewScheduler(engine)
	defer scheduler.Close()
	defer close(engine.release)

	scheduler.StartGame(StartInput{
		Token:       "secret",
		GameID:      "game-a",
		DisplayName: "Alpha vs Beta",
		FocusNodeID: "main:0",
		WorkerName:  "gpu-1",
		Nodes: []NodeInput{
			{NodeID: "main:0", MoveNumber: 0, ToPlay: game.Black, Rules: "chinese", Komi: 7.5},
			{NodeID: "main:1", MoveNumber: 1, ToPlay: game.White, Rules: "chinese", Komi: 7.5},
		},
	})

	start := waitWorkerStart(t, engine.started)
	if start.WorkerName != "gpu-1" || start.QueryID != "main:0" {
		t.Fatalf("start = %#v", start)
	}

	snapshot := scheduler.Snapshot()
	if len(snapshot.Lanes) != 1 {
		t.Fatalf("lanes = %#v", snapshot.Lanes)
	}
	lane := snapshot.Lanes[0]
	if lane.WorkerName != "gpu-1" || lane.Current == nil {
		t.Fatalf("lane = %#v", lane)
	}
	if lane.Current.GameID != "game-a" || lane.Current.DisplayName != "Alpha vs Beta" || lane.Current.Analyzed != 0 || lane.Current.Total != 2 {
		t.Fatalf("current = %#v", lane.Current)
	}
	if len(lane.Queue) != 0 || len(lane.HighPriority) != 0 {
		t.Fatalf("queues = high %#v normal %#v", lane.HighPriority, lane.Queue)
	}
}
```

Add these helpers in the same file:

```go
type workerStart struct {
	WorkerName string
	QueryID    string
}

type blockingWorkerAnalyzer struct {
	started chan workerStart
	release chan struct{}
}

func (f *blockingWorkerAnalyzer) Analyze(ctx context.Context, query katago.Query) (katago.Result, error) {
	return katago.Result{}, errors.New("unexpected unbound analysis")
}

func (f *blockingWorkerAnalyzer) AnalyzeWithWorkerProgress(ctx context.Context, workerName string, query katago.Query, progress func(katago.Result)) (katago.Result, error) {
	f.started <- workerStart{WorkerName: workerName, QueryID: query.ID}
	select {
	case <-ctx.Done():
		return katago.Result{}, ctx.Err()
	case <-f.release:
		return katago.Result{ID: query.ID, RootInfo: katago.RootInfo{Visits: 100}}, nil
	}
}

func (f *blockingWorkerAnalyzer) Available() bool { return true }

func (f *blockingWorkerAnalyzer) Status() katago.Status {
	return katago.Status{Available: true}
}

func (f *blockingWorkerAnalyzer) Close() error { return nil }

func waitWorkerStart(t *testing.T, ch <-chan workerStart) workerStart {
	t.Helper()
	select {
	case start := <-ch:
		return start
	case <-time.After(time.Second):
		t.Fatal("expected worker analysis to start")
		return workerStart{}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/app -run TestSchedulerSnapshotShowsQueuedBackgroundRunsByWorker`

Expected: FAIL with `scheduler.Snapshot undefined` or missing `DisplayName` on `StartInput`.

- [ ] **Step 3: Add schedule snapshot structs and fields**

In `internal/app/scheduler.go`, extend `StartInput` and add snapshot structs:

```go
type StartInput struct {
	Token       string
	GameID      string
	DisplayName string
	FocusNodeID string
	WorkerName  string
	Nodes       []NodeInput
}

type ScheduleSnapshot struct {
	Lanes []WorkerLaneSnapshot `json:"lanes"`
}

type WorkerLaneSnapshot struct {
	WorkerName   string                 `json:"workerName"`
	Current      *ScheduleTaskSnapshot  `json:"current,omitempty"`
	HighPriority []ScheduleTaskSnapshot `json:"highPriority"`
	Queue        []ScheduleTaskSnapshot `json:"queue"`
}

type ScheduleTaskSnapshot struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	GameID      string `json:"gameId"`
	DisplayName string `json:"displayName"`
	NodeID      string `json:"nodeId,omitempty"`
	MoveNumber  int    `json:"moveNumber,omitempty"`
	WorkerName  string `json:"workerName"`
	Analyzed    int    `json:"analyzed"`
	Total       int    `json:"total"`
	Status      string `json:"status"`
	CanBoost    bool   `json:"canBoost"`
}
```

Add constants:

```go
const (
	scheduleTaskBackground = "background"
	scheduleTaskTrial      = "trial"
	scheduleStatusQueued   = "queued"
	scheduleStatusRunning  = "running"
)
```

- [ ] **Step 4: Add temporary Snapshot implementation for current scheduler**

Still in `internal/app/scheduler.go`, add:

```go
func (s *Scheduler) Snapshot() ScheduleSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	return ScheduleSnapshot{Lanes: []WorkerLaneSnapshot{}}
}
```

This is intentionally incomplete and should make the test fail on lane contents.

- [ ] **Step 5: Run test to verify correct failure**

Run: `go test ./internal/app -run TestSchedulerSnapshotShowsQueuedBackgroundRunsByWorker`

Expected: FAIL with `lanes = []`, proving the test now reaches behavior.

- [ ] **Step 6: Commit**

```powershell
git add internal/app/scheduler.go internal/app/scheduler_test.go
git commit -m "test: cover analysis schedule snapshot"
```

---

### Task 2: Per-Worker Lane Scheduler Core

**Files:**
- Modify: `internal/app/scheduler.go`
- Modify: `internal/app/scheduler_test.go`

- [ ] **Step 1: Write failing parallel worker test**

Add:

```go
func TestSchedulerRunsDifferentWorkersInParallel(t *testing.T) {
	engine := &blockingWorkerAnalyzer{
		started: make(chan workerStart, 4),
		release: make(chan struct{}),
	}
	scheduler := NewScheduler(engine)
	defer scheduler.Close()
	defer close(engine.release)

	scheduler.StartGame(StartInput{
		Token: "secret", GameID: "game-a", DisplayName: "A",
		FocusNodeID: "main:0", WorkerName: "gpu-1",
		Nodes: []NodeInput{{NodeID: "main:0", MoveNumber: 0, ToPlay: game.Black, Rules: "chinese", Komi: 7.5}},
	})
	scheduler.StartGame(StartInput{
		Token: "secret", GameID: "game-b", DisplayName: "B",
		FocusNodeID: "main:0", WorkerName: "gpu-2",
		Nodes: []NodeInput{{NodeID: "main:0", MoveNumber: 0, ToPlay: game.Black, Rules: "chinese", Komi: 7.5}},
	})

	first := waitWorkerStart(t, engine.started)
	second := waitWorkerStart(t, engine.started)
	got := map[string]string{first.WorkerName: first.QueryID, second.WorkerName: second.QueryID}
	if got["gpu-1"] != "main:0" || got["gpu-2"] != "main:0" {
		t.Fatalf("starts = %#v", got)
	}
}
```

- [ ] **Step 2: Write failing same-worker serial test**

Add:

```go
func TestSchedulerSerializesGamesOnSameWorker(t *testing.T) {
	engine := &blockingWorkerAnalyzer{
		started: make(chan workerStart, 4),
		release: make(chan struct{}),
	}
	scheduler := NewScheduler(engine)
	defer scheduler.Close()
	defer close(engine.release)

	scheduler.StartGame(StartInput{
		Token: "secret", GameID: "game-a", DisplayName: "A",
		FocusNodeID: "main:0", WorkerName: "gpu-1",
		Nodes: []NodeInput{{NodeID: "main:0", MoveNumber: 0, ToPlay: game.Black, Rules: "chinese", Komi: 7.5}},
	})
	scheduler.StartGame(StartInput{
		Token: "secret", GameID: "game-b", DisplayName: "B",
		FocusNodeID: "main:10", WorkerName: "gpu-1",
		Nodes: []NodeInput{{NodeID: "main:10", MoveNumber: 10, ToPlay: game.Black, Rules: "chinese", Komi: 7.5}},
	})

	first := waitWorkerStart(t, engine.started)
	if first.WorkerName != "gpu-1" || first.QueryID != "main:0" {
		t.Fatalf("first = %#v", first)
	}
	select {
	case second := <-engine.started:
		t.Fatalf("second started before first released: %#v", second)
	case <-time.After(100 * time.Millisecond):
	}
	engine.release <- struct{}{}
	second := waitWorkerStart(t, engine.started)
	if second.WorkerName != "gpu-1" || second.QueryID != "main:10" {
		t.Fatalf("second = %#v", second)
	}
}
```

- [ ] **Step 3: Run tests to verify failure**

Run: `go test ./internal/app -run "TestSchedulerRunsDifferentWorkersInParallel|TestSchedulerSerializesGamesOnSameWorker"`

Expected: current single-loop scheduler cannot start both workers in parallel, so the first test times out.

- [ ] **Step 4: Replace scheduler queue fields with lane state**

In `Scheduler`, replace `tasks chan task` with lane fields:

```go
type Scheduler struct {
	engine      katago.Analyzer
	closed      chan struct{}
	closeOnce   sync.Once
	mu          sync.Mutex
	runs        map[string]*analysisRun
	lanes       map[string]*workerLane
	subscribers map[int]Subscriber
	nextSubID   int
	nextRunID   uint64
}

type workerLane struct {
	workerName   string
	wake         chan struct{}
	running      bool
	current      *scheduledNode
	activeRun    *analysisRun
	highPriority []*scheduledNode
	queue        []*analysisRun
}

type analysisRun struct {
	id          string
	token       string
	gameID      string
	displayName string
	workerName  string
	generation  uint64
	nodes       []NodeInput
	nextIndex   int
	analyzed    int
	stopped     bool
	cancel      context.CancelFunc
}

type scheduledNode struct {
	id          string
	kind        string
	token       string
	gameID      string
	displayName string
	workerName  string
	generation  uint64
	node        NodeInput
	run         *analysisRun
	cancel      context.CancelFunc
}
```

Update `NewScheduler` initialization:

```go
s := &Scheduler{
	engine:      engine,
	closed:      make(chan struct{}),
	runs:        map[string]*analysisRun{},
	lanes:       map[string]*workerLane{},
	subscribers: map[int]Subscriber{},
}
```

Remove the old `run()` goroutine startup.

- [ ] **Step 5: Implement lane lookup and wake**

Add:

```go
func (s *Scheduler) laneForLocked(workerName string) *workerLane {
	lane := s.lanes[workerName]
	if lane != nil {
		return lane
	}
	lane = &workerLane{
		workerName:   workerName,
		wake:         make(chan struct{}, 1),
		highPriority: []*scheduledNode{},
		queue:        []*analysisRun{},
	}
	s.lanes[workerName] = lane
	return lane
}

func (s *Scheduler) wakeLane(lane *workerLane) {
	select {
	case lane.wake <- struct{}{}:
	default:
	}
}

func (s *Scheduler) ensureLaneRunner(lane *workerLane) {
	if lane.running {
		return
	}
	lane.running = true
	go s.runLane(lane.workerName)
}
```

- [ ] **Step 6: Implement StartGame as whole-game run enqueue**

Replace `StartGame` with:

```go
func (s *Scheduler) StartGame(input StartInput) {
	ordered := orderFocusFirst(input.Nodes, input.FocusNodeID)
	key := analysisKey(input.Token, input.GameID)
	var oldCancel context.CancelFunc
	var lane *workerLane

	s.mu.Lock()
	if existing := s.runs[key]; existing != nil {
		oldCancel = existing.cancel
		s.removeRunFromLaneLocked(existing)
		existing.stopped = true
		existing.generation++
	}
	s.nextRunID++
	run := &analysisRun{
		id:          fmt.Sprintf("run-%d", s.nextRunID),
		token:       input.Token,
		gameID:      input.GameID,
		displayName: input.DisplayName,
		workerName:  input.WorkerName,
		generation:  1,
		nodes:       ordered,
	}
	s.runs[key] = run
	lane = s.laneForLocked(input.WorkerName)
	if len(ordered) > 0 {
		lane.queue = append(lane.queue, run)
	}
	s.ensureLaneRunner(lane)
	s.wakeLane(lane)
	s.mu.Unlock()

	if oldCancel != nil {
		oldCancel()
	}
}
```

Add removal helper:

```go
func (s *Scheduler) removeRunFromLaneLocked(run *analysisRun) {
	lane := s.lanes[run.workerName]
	if lane == nil {
		return
	}
	if lane.activeRun == run {
		lane.activeRun = nil
	}
	for i, queued := range lane.queue {
		if queued == run {
			lane.queue = append(lane.queue[:i], lane.queue[i+1:]...)
			return
		}
	}
}
```

- [ ] **Step 7: Implement lane runner and task selection**

Add:

```go
func (s *Scheduler) runLane(workerName string) {
	defer func() {
		s.mu.Lock()
		if lane := s.lanes[workerName]; lane != nil {
			lane.running = false
		}
		s.mu.Unlock()
	}()
	for {
		task, ok := s.nextLaneTask(workerName)
		if !ok {
			return
		}
		s.executeScheduledNode(task)
	}
}

func (s *Scheduler) nextLaneTask(workerName string) (scheduledNode, bool) {
	for {
		s.mu.Lock()
		lane := s.lanes[workerName]
		if lane == nil {
			s.mu.Unlock()
			return scheduledNode{}, false
		}
		if len(lane.highPriority) > 0 {
			task := lane.highPriority[0]
			lane.highPriority = lane.highPriority[1:]
			lane.current = task
			s.mu.Unlock()
			return *task, true
		}
		for {
			run := lane.activeRun
			if run == nil {
				if len(lane.queue) == 0 {
					break
				}
				run = lane.queue[0]
				lane.queue = lane.queue[1:]
				lane.activeRun = run
			}
			if run.stopped || run.nextIndex >= len(run.nodes) {
				lane.activeRun = nil
				continue
			}
			task := &scheduledNode{
				id:          run.id + ":" + run.nodes[run.nextIndex].NodeID,
				kind:        scheduleTaskBackground,
				token:       run.token,
				gameID:      run.gameID,
				displayName: run.displayName,
				workerName:  run.workerName,
				generation:  run.generation,
				node:        run.nodes[run.nextIndex],
				run:         run,
			}
			lane.current = task
			s.mu.Unlock()
			return *task, true
		}
		lane.current = nil
		wake := lane.wake
		s.mu.Unlock()

		select {
		case <-s.closed:
			return scheduledNode{}, false
		case <-wake:
			continue
		}
	}
}
```

- [ ] **Step 8: Implement scheduled node execution**

Add:

```go
func (s *Scheduler) executeScheduledNode(task scheduledNode) {
	query := katago.BuildQuery(katago.BuildInput{
		ID:            task.node.NodeID,
		Rules:         task.node.Rules,
		Komi:          task.node.Komi,
		InitialStones: task.node.InitialStones,
		InitialPlayer: string(task.node.InitialPlayer),
		Moves:         task.node.Moves,
		AnalyzeTurn:   task.node.MoveNumber,
	})
	ctx, cancel := context.WithCancel(context.Background())
	s.setTaskCancel(task, cancel)
	result, err := s.analyze(ctx, task.toLegacyTask(), query)
	s.finishScheduledNode(task, cancel, result, err)
}

func (task scheduledNode) toLegacyTask() task {
	return task{
		token:      task.token,
		gameID:     task.gameID,
		workerName: task.workerName,
		generation: task.generation,
		node:       task.node,
	}
}
```

Keep the old `task` struct for `publishAnalysis`, `publishError`, and `analyze` until the implementation is stable.

- [ ] **Step 9: Implement cancel/progress completion**

Add:

```go
func (s *Scheduler) setTaskCancel(task scheduledNode, cancel context.CancelFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if task.kind == scheduleTaskBackground && task.run != nil && task.run.generation == task.generation && !task.run.stopped {
		task.run.cancel = cancel
		return
	}
	lane := s.lanes[task.workerName]
	if lane != nil && lane.current != nil && lane.current.id == task.id {
		lane.current.cancel = cancel
	}
}

func (s *Scheduler) finishScheduledNode(task scheduledNode, cancel context.CancelFunc, result katago.Result, err error) {
	cancel()
	legacy := task.toLegacyTask()
	if err != nil {
		if errors.Is(err, context.Canceled) && !s.isScheduledTaskActive(task) {
			s.clearCurrentTask(task)
			return
		}
		if task.kind == scheduleTaskBackground {
			s.stopRun(task.token, task.gameID)
		}
		s.publishError(legacy, err)
		s.clearCurrentTask(task)
		return
	}
	if !s.isScheduledTaskActive(task) {
		s.clearCurrentTask(task)
		return
	}
	s.publishAnalysis(legacy, result)
	s.markTaskComplete(task)
	s.clearCurrentTask(task)
}

func (s *Scheduler) markTaskComplete(task scheduledNode) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if task.kind != scheduleTaskBackground || task.run == nil {
		return
	}
	run := s.runs[analysisKey(task.token, task.gameID)]
	if run == nil || run.generation != task.generation || run.stopped {
		return
	}
	run.nextIndex++
	run.analyzed++
	if run.nextIndex >= len(run.nodes) {
		run.stopped = true
		delete(s.runs, analysisKey(task.token, task.gameID))
		lane := s.lanes[task.workerName]
		if lane != nil && lane.activeRun == run {
			lane.activeRun = nil
		}
	}
}
```

Add `isScheduledTaskActive` and `clearCurrentTask`:

```go
func (s *Scheduler) isScheduledTaskActive(task scheduledNode) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if task.kind == scheduleTaskBackground {
		run := s.runs[analysisKey(task.token, task.gameID)]
		return run != nil && run.generation == task.generation && !run.stopped
	}
	lane := s.lanes[task.workerName]
	return lane != nil && lane.current != nil && lane.current.id == task.id
}

func (s *Scheduler) clearCurrentTask(task scheduledNode) {
	s.mu.Lock()
	defer s.mu.Unlock()
	lane := s.lanes[task.workerName]
	if lane != nil && lane.current != nil && lane.current.id == task.id {
		lane.current = nil
	}
}
```

- [ ] **Step 10: Update Snapshot to read lane state**

Replace the temporary `Snapshot` implementation:

```go
func (s *Scheduler) Snapshot() ScheduleSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	names := make([]string, 0, len(s.lanes))
	for name := range s.lanes {
		names = append(names, name)
	}
	sort.Strings(names)

	lanes := make([]WorkerLaneSnapshot, 0, len(names))
	for _, name := range names {
		lane := s.lanes[name]
		item := WorkerLaneSnapshot{
			WorkerName:   name,
			HighPriority: []ScheduleTaskSnapshot{},
			Queue:        []ScheduleTaskSnapshot{},
		}
		if lane.current != nil {
			current := scheduleSnapshotForTask(*lane.current, scheduleStatusRunning, false)
			item.Current = &current
		}
		for _, task := range lane.highPriority {
			item.HighPriority = append(item.HighPriority, scheduleSnapshotForTask(*task, scheduleStatusQueued, false))
		}
		for index, run := range lane.queue {
			if run.stopped || run.nextIndex >= len(run.nodes) {
				continue
			}
			item.Queue = append(item.Queue, scheduleSnapshotForRun(run, index > 0))
		}
		lanes = append(lanes, item)
	}
	return ScheduleSnapshot{Lanes: lanes}
}

func scheduleSnapshotForRun(run *analysisRun, canBoost bool) ScheduleTaskSnapshot {
	nodeID := ""
	moveNumber := 0
	if run.nextIndex < len(run.nodes) {
		nodeID = run.nodes[run.nextIndex].NodeID
		moveNumber = run.nodes[run.nextIndex].MoveNumber
	}
	return ScheduleTaskSnapshot{
		ID:          run.id,
		Kind:        scheduleTaskBackground,
		GameID:      run.gameID,
		DisplayName: run.displayName,
		NodeID:      nodeID,
		MoveNumber:  moveNumber,
		WorkerName:  run.workerName,
		Analyzed:    run.analyzed,
		Total:       len(run.nodes),
		Status:      scheduleStatusQueued,
		CanBoost:    canBoost,
	}
}

func scheduleSnapshotForTask(task scheduledNode, status string, canBoost bool) ScheduleTaskSnapshot {
	total := 1
	analyzed := 0
	if task.kind == scheduleTaskBackground && task.run != nil {
		total = len(task.run.nodes)
		analyzed = task.run.analyzed
	}
	return ScheduleTaskSnapshot{
		ID:          task.id,
		Kind:        task.kind,
		GameID:      task.gameID,
		DisplayName: task.displayName,
		NodeID:      task.node.NodeID,
		MoveNumber:  task.node.MoveNumber,
		WorkerName:  task.workerName,
		Analyzed:    analyzed,
		Total:       total,
		Status:      status,
		CanBoost:    canBoost,
	}
}
```

Add `sort` import.

- [ ] **Step 11: Run scheduler tests**

Run: `go test ./internal/app -run "TestSchedulerSnapshotShowsQueuedBackgroundRunsByWorker|TestSchedulerRunsDifferentWorkersInParallel|TestSchedulerSerializesGamesOnSameWorker"`

Expected: PASS.

- [ ] **Step 12: Commit**

```powershell
git add internal/app/scheduler.go internal/app/scheduler_test.go
git commit -m "feat: schedule analysis by worker lane"
```

---

### Task 3: High-Priority Trial Tasks, Manual Boost, and Stop Semantics

**Files:**
- Modify: `internal/app/scheduler.go`
- Modify: `internal/app/scheduler_test.go`

- [ ] **Step 1: Write failing trial-priority test**

Add:

```go
func TestSchedulerRunsTrialTaskBeforeQueuedBackgroundGame(t *testing.T) {
	engine := &blockingWorkerAnalyzer{
		started: make(chan workerStart, 8),
		release: make(chan struct{}),
	}
	scheduler := NewScheduler(engine)
	defer scheduler.Close()
	defer close(engine.release)

	scheduler.StartGame(StartInput{
		Token: "secret", GameID: "game-a", DisplayName: "A",
		FocusNodeID: "main:0", WorkerName: "gpu-1",
		Nodes: []NodeInput{
			{NodeID: "main:0", MoveNumber: 0, ToPlay: game.Black, Rules: "chinese", Komi: 7.5},
			{NodeID: "main:1", MoveNumber: 1, ToPlay: game.White, Rules: "chinese", Komi: 7.5},
		},
	})
	_ = waitWorkerStart(t, engine.started)

	scheduler.StartGame(StartInput{
		Token: "secret", GameID: "game-b", DisplayName: "B",
		FocusNodeID: "main:10", WorkerName: "gpu-1",
		Nodes: []NodeInput{{NodeID: "main:10", MoveNumber: 10, ToPlay: game.Black, Rules: "chinese", Komi: 7.5}},
	})
	scheduler.AnalyzeNow(StartInput{
		Token: "secret", GameID: "game-a", DisplayName: "A",
		FocusNodeID: "var:1", WorkerName: "gpu-1",
		Nodes: []NodeInput{{NodeID: "var:1", MoveNumber: 2, ToPlay: game.Black, Rules: "chinese", Komi: 7.5}},
	})

	engine.release <- struct{}{}
	second := waitWorkerStart(t, engine.started)
	if second.QueryID != "var:1" {
		t.Fatalf("second query = %q, want trial var:1", second.QueryID)
	}
}
```

- [ ] **Step 2: Write failing boost test**

Add:

```go
func TestSchedulerBoostMovesQueuedGameToFront(t *testing.T) {
	engine := &blockingWorkerAnalyzer{
		started: make(chan workerStart, 8),
		release: make(chan struct{}),
	}
	scheduler := NewScheduler(engine)
	defer scheduler.Close()
	defer close(engine.release)

	for _, item := range []struct{ id, name, nodeID string }{
		{"game-a", "A", "main:0"},
		{"game-b", "B", "main:10"},
		{"game-c", "C", "main:20"},
	} {
		scheduler.StartGame(StartInput{
			Token: "secret", GameID: item.id, DisplayName: item.name,
			FocusNodeID: item.nodeID, WorkerName: "gpu-1",
			Nodes: []NodeInput{{NodeID: item.nodeID, MoveNumber: 0, ToPlay: game.Black, Rules: "chinese", Komi: 7.5}},
		})
	}
	_ = waitWorkerStart(t, engine.started)
	if !scheduler.BoostGame("secret", "game-c") {
		t.Fatal("BoostGame returned false")
	}
	engine.release <- struct{}{}
	next := waitWorkerStart(t, engine.started)
	if next.QueryID != "main:20" {
		t.Fatalf("next = %#v", next)
	}
	snapshot := scheduler.Snapshot()
	if snapshot.Lanes[0].Current == nil || snapshot.Lanes[0].Current.GameID != "game-c" {
		t.Fatalf("snapshot = %#v", snapshot)
	}
}
```

- [ ] **Step 3: Write failing stop-current-game-only test**

Add:

```go
func TestSchedulerStopGameRemovesOnlyThatGame(t *testing.T) {
	engine := &blockingWorkerAnalyzer{
		started: make(chan workerStart, 8),
		release: make(chan struct{}),
	}
	scheduler := NewScheduler(engine)
	defer scheduler.Close()
	defer close(engine.release)

	scheduler.StartGame(StartInput{
		Token: "secret", GameID: "game-a", DisplayName: "A",
		FocusNodeID: "main:0", WorkerName: "gpu-1",
		Nodes: []NodeInput{{NodeID: "main:0", MoveNumber: 0, ToPlay: game.Black, Rules: "chinese", Komi: 7.5}},
	})
	scheduler.StartGame(StartInput{
		Token: "secret", GameID: "game-b", DisplayName: "B",
		FocusNodeID: "main:10", WorkerName: "gpu-1",
		Nodes: []NodeInput{{NodeID: "main:10", MoveNumber: 10, ToPlay: game.Black, Rules: "chinese", Komi: 7.5}},
	})
	_ = waitWorkerStart(t, engine.started)
	scheduler.StopGame("secret", "game-a")

	next := waitWorkerStart(t, engine.started)
	if next.WorkerName != "gpu-1" || next.QueryID != "main:10" {
		t.Fatalf("next = %#v", next)
	}
	snapshot := scheduler.Snapshot()
	if snapshot.Lanes[0].Current == nil || snapshot.Lanes[0].Current.GameID != "game-b" {
		t.Fatalf("snapshot = %#v", snapshot)
	}
}
```

- [ ] **Step 4: Run tests to verify failure**

Run: `go test ./internal/app -run "TestSchedulerRunsTrialTaskBeforeQueuedBackgroundGame|TestSchedulerBoostMovesQueuedGameToFront|TestSchedulerStopGameRemovesOnlyThatGame"`

Expected: FAIL because `AnalyzeNow` still starts a full run or `BoostGame` is missing.

- [ ] **Step 5: Implement AnalyzeNow as high-priority single-node enqueue**

Replace `AnalyzeNow`:

```go
func (s *Scheduler) AnalyzeNow(input StartInput) {
	if len(input.Nodes) == 0 {
		return
	}
	node := input.Nodes[0]
	s.nextRunID++
	task := &scheduledNode{
		id:          fmt.Sprintf("trial-%d", s.nextRunID),
		kind:        scheduleTaskTrial,
		token:       input.Token,
		gameID:      input.GameID,
		displayName: input.DisplayName,
		workerName:  input.WorkerName,
		generation:  1,
		node:        node,
	}
	s.mu.Lock()
	lane := s.laneForLocked(input.WorkerName)
	lane.highPriority = append(lane.highPriority, task)
	s.ensureLaneRunner(lane)
	s.wakeLane(lane)
	s.mu.Unlock()
}
```

- [ ] **Step 6: Implement BoostGame**

Add to `Scheduler`:

```go
func (s *Scheduler) BoostGame(token, gameID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	run := s.runs[analysisKey(token, gameID)]
	if run == nil || run.stopped {
		return false
	}
	lane := s.lanes[run.workerName]
	if lane == nil {
		return false
	}
	for index, queued := range lane.queue {
		if queued != run {
			continue
		}
		if index == 0 {
			return true
		}
		lane.queue = append(lane.queue[:index], lane.queue[index+1:]...)
		lane.queue = append([]*analysisRun{run}, lane.queue...)
		s.wakeLane(lane)
		return true
	}
	return false
}
```

- [ ] **Step 7: Update StopGame to cancel current and remove queued run**

Replace `stopRun` body with:

```go
func (s *Scheduler) stopRun(token, gameID string) {
	key := analysisKey(token, gameID)
	var cancel context.CancelFunc
	s.mu.Lock()
	run := s.runs[key]
	if run != nil {
		run.stopped = true
		run.generation++
		cancel = run.cancel
		run.cancel = nil
		s.removeRunFromLaneLocked(run)
		delete(s.runs, key)
	}
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}
```

- [ ] **Step 8: Run scheduler tests**

Run: `go test ./internal/app -run "TestSchedulerRunsTrialTaskBeforeQueuedBackgroundGame|TestSchedulerBoostMovesQueuedGameToFront|TestSchedulerStopGameRemovesOnlyThatGame|TestSchedulerStopCancelsInFlightWorkerAnalysis"`

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add internal/app/scheduler.go internal/app/scheduler_test.go
git commit -m "feat: prioritize trial analysis and boost games"
```

---

### Task 4: Handler Integration and Schedule State Payload

**Files:**
- Modify: `internal/app/handlers.go`
- Modify: `internal/app/state.go`
- Modify: `internal/app/state_payload.go`
- Modify: `internal/app/handlers_test.go`

- [ ] **Step 1: Write failing state payload test**

Add to `internal/app/handlers_test.go`:

```go
func TestWorkspaceStateIncludesAnalysisSchedule(t *testing.T) {
	h, token := newTestHandlerWithWorker(t, "local-gpu")
	recorder := &recordingAnalysisController{
		snapshot: ScheduleSnapshot{Lanes: []WorkerLaneSnapshot{{
			WorkerName: "local-gpu",
			Current: &ScheduleTaskSnapshot{
				ID: "run-1:main:1", Kind: "background", GameID: "game-1", DisplayName: "Lee vs Cho",
				NodeID: "main:1", WorkerName: "local-gpu", Analyzed: 3, Total: 10, Status: "running",
			},
			HighPriority: []ScheduleTaskSnapshot{},
			Queue: []ScheduleTaskSnapshot{{
				ID: "run-2", Kind: "background", GameID: "game-2", DisplayName: "Queued",
				NodeID: "main:0", WorkerName: "local-gpu", Analyzed: 0, Total: 5, Status: "queued", CanBoost: true,
			}},
		}}},
	}
	h.analysis = recorder

	state := callResult[StatePayload](t, h, token, "workspace.state", nil)
	if len(state.AnalysisSchedule.Lanes) != 1 {
		t.Fatalf("schedule = %#v", state.AnalysisSchedule)
	}
	if state.AnalysisSchedule.Lanes[0].Current.DisplayName != "Lee vs Cho" {
		t.Fatalf("schedule = %#v", state.AnalysisSchedule)
	}
	if !state.AnalysisSchedule.Lanes[0].Queue[0].CanBoost {
		t.Fatalf("queued item = %#v", state.AnalysisSchedule.Lanes[0].Queue[0])
	}
}
```

- [ ] **Step 2: Write failing boost RPC test**

Add:

```go
func TestAnalysisBoostCallsController(t *testing.T) {
	h, token := newTestHandlerWithWorker(t, "local-gpu")
	recorder := &recordingAnalysisController{}
	h.analysis = recorder
	imported := callResult[ImportResult](t, h, token, "game.importSgf", map[string]any{
		"displayName": "Demo",
		"sgfText":     "(;GM[1]FF[4]SZ[19];B[pd])",
	})

	_ = callResult[StatePayload](t, h, token, "analysis.boost", map[string]any{"gameId": imported.Game.ID})

	if len(recorder.boosted) != 1 || recorder.boosted[0] != token+"\x00"+imported.Game.ID {
		t.Fatalf("boosted = %#v", recorder.boosted)
	}
}
```

- [ ] **Step 3: Run tests to verify failure**

Run: `go test ./internal/app -run "TestWorkspaceStateIncludesAnalysisSchedule|TestAnalysisBoostCallsController"`

Expected: FAIL because `AnalysisSchedule` and `analysis.boost` are missing.

- [ ] **Step 4: Extend AnalysisController interface**

In `internal/app/handlers.go`:

```go
type AnalysisController interface {
	StartGame(StartInput)
	StopGame(token, gameID string)
	RestartGame(StartInput)
	AnalyzeNow(StartInput)
	BoostGame(token, gameID string) bool
	Snapshot() ScheduleSnapshot
	Subscribe(Subscriber) func()
	Status() katago.Status
}
```

- [ ] **Step 5: Add AnalysisSchedule to state payloads**

In `internal/app/state_payload.go`:

```go
type StatePayload struct {
	Type             string                `json:"type"`
	Schema           int                   `json:"schema"`
	Games            []store.GameRecord    `json:"games"`
	GameID           string                `json:"gameId"`
	CurrentNodeID    string                `json:"currentNodeId"`
	AnalysisState    AnalysisState         `json:"analysisState"`
	AnalysisError    string                `json:"analysisError,omitempty"`
	WorkerStatus     worker.StatusSnapshot `json:"workerStatus"`
	AnalysisSchedule ScheduleSnapshot      `json:"analysisSchedule"`
	Snapshot         game.Snapshot         `json:"snapshot"`
	Timeline         TimelineColumns       `json:"timeline"`
	BadMoves         BadMoveColumns        `json:"badMoves"`
	Variation        *VariationState       `json:"variation,omitempty"`
	Current          CurrentNodeState      `json:"current"`
}
```

In `internal/app/state.go`, add the same field to `EmptyWorkspaceState`:

```go
type EmptyWorkspaceState struct {
	Type             string                `json:"type"`
	Schema           int                   `json:"schema"`
	Games            []store.GameRecord    `json:"games"`
	AnalysisState    AnalysisState         `json:"analysisState"`
	AnalysisError    string                `json:"analysisError,omitempty"`
	WorkerStatus     worker.StatusSnapshot `json:"workerStatus"`
	AnalysisSchedule ScheduleSnapshot      `json:"analysisSchedule"`
}
```

- [ ] **Step 6: Populate schedule in workspaceState**

In `workspaceState`, compute:

```go
schedule := h.analysisSchedule()
```

Use it in empty payload:

```go
return EmptyWorkspaceState{Type: "state", Schema: 1, Games: games, AnalysisState: AnalysisIdle, WorkerStatus: workerStatus, AnalysisSchedule: schedule}, nil
```

Use it in selected payload:

```go
payload.WorkerStatus = workerStatus
payload.AnalysisSchedule = schedule
return payload, nil
```

Add helper:

```go
func (h *Handler) analysisSchedule() ScheduleSnapshot {
	if h.analysis == nil {
		return ScheduleSnapshot{Lanes: []WorkerLaneSnapshot{}}
	}
	snapshot := h.analysis.Snapshot()
	if snapshot.Lanes == nil {
		snapshot.Lanes = []WorkerLaneSnapshot{}
	}
	return snapshot
}
```

- [ ] **Step 7: Pass display names into scheduler calls**

In `analysisCall`, after loading `record` for starts/restarts:

```go
record, err := h.repo.GetGame(ctx, in.GameID)
if err != nil {
	return nil, err
}
displayName := record.DisplayName
```

Set:

```go
input := StartInput{
	Token:       token,
	GameID:      in.GameID,
	DisplayName: displayName,
	WorkerName:  workerName,
	FocusNodeID: snapshot.NodeID,
	Nodes:       ws.MissingMainlineAnalysisInputs(in.GameID),
}
```

In `analyzeCurrentNode`, load the record and set `DisplayName`:

```go
record, err := h.repo.GetGame(ctx, gameID)
if err != nil {
	ws.SetAnalysisError(gameID, err.Error())
	return
}
h.analysis.AnalyzeNow(StartInput{
	Token:       token,
	GameID:      gameID,
	DisplayName: record.DisplayName,
	WorkerName:  workerName,
	FocusNodeID: nodeID,
	Nodes:       []NodeInput{input},
})
```

- [ ] **Step 8: Add analysis.boost RPC**

In `Call` switch:

```go
case "analysis.boost":
	return h.boostAnalysis(ctx, token, params)
```

Add method:

```go
func (h *Handler) boostAnalysis(ctx context.Context, token string, params json.RawMessage) (any, error) {
	var in gameIDParams
	if err := decodeParams(params, &in); err != nil {
		return nil, err
	}
	if h.analysis == nil {
		return nil, errors.New("analysis is unavailable")
	}
	if _, err := h.ensureWorkspaceGame(ctx, token, in.GameID); err != nil {
		return nil, err
	}
	h.analysis.BoostGame(token, in.GameID)
	return h.workspaceState(ctx, token)
}
```

- [ ] **Step 9: Update recordingAnalysisController helper**

In `handlers_test.go`, extend the fake:

```go
type recordingAnalysisController struct {
	started     []StartInput
	restarted   []StartInput
	analyzedNow []StartInput
	stopped     []string
	boosted     []string
	snapshot    ScheduleSnapshot
}

func (r *recordingAnalysisController) BoostGame(token, gameID string) bool {
	r.boosted = append(r.boosted, token+"\x00"+gameID)
	return true
}

func (r *recordingAnalysisController) Snapshot() ScheduleSnapshot {
	if r.snapshot.Lanes == nil {
		return ScheduleSnapshot{Lanes: []WorkerLaneSnapshot{}}
	}
	return r.snapshot
}
```

- [ ] **Step 10: Run handler tests**

Run: `go test ./internal/app -run "TestWorkspaceStateIncludesAnalysisSchedule|TestAnalysisBoostCallsController|TestAnalysisStartStoresResultInWorkspace|TestPlayQueuesCurrentNodeWithSelectedWorker"`

Expected: PASS.

- [ ] **Step 11: Commit**

```powershell
git add internal/app/handlers.go internal/app/state.go internal/app/state_payload.go internal/app/handlers_test.go
git commit -m "feat: expose analysis schedule state"
```

---

### Task 5: Frontend Types and RPC Wiring

**Files:**
- Modify: `web/src/api/types.ts`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Update TypeScript schedule types**

In `web/src/api/types.ts`, add:

```ts
export interface AnalysisSchedule {
  lanes: AnalysisWorkerLane[]
}

export interface AnalysisWorkerLane {
  workerName: string
  current?: AnalysisScheduleTask
  highPriority: AnalysisScheduleTask[]
  queue: AnalysisScheduleTask[]
}

export type AnalysisScheduleTaskKind = 'background' | 'trial'
export type AnalysisScheduleTaskStatus = 'queued' | 'running'

export interface AnalysisScheduleTask {
  id: string
  kind: AnalysisScheduleTaskKind
  gameId: string
  displayName: string
  nodeId?: string
  moveNumber?: number
  workerName: string
  analyzed: number
  total: number
  status: AnalysisScheduleTaskStatus
  canBoost: boolean
}
```

Extend `StatePayload`:

```ts
analysisSchedule?: AnalysisSchedule
```

- [ ] **Step 2: Wire boost RPC and schedule prop**

In `web/src/App.tsx`, import the new type if needed and add:

```ts
const boostAnalysis = async (gameId: string) => {
  if (!client) return
  const state = await client.call<StatePayload>('analysis.boost', { gameId })
  applyWorkspaceState(state)
}
```

Pass props to `GameSidebar`:

```tsx
analysisSchedule={workspace?.analysisSchedule}
onBoostAnalysis={boostAnalysis}
```

- [ ] **Step 3: Run TypeScript build to verify current component errors**

Run: `npm run build`

Expected: FAIL because `GameSidebar` does not yet accept `analysisSchedule` and `onBoostAnalysis`.

- [ ] **Step 4: Commit frontend type wiring**

Commit after Task 6 makes build pass, not before. Keep these changes staged only after component work.

---

### Task 6: Analysis Menu Worker Lane UI

**Files:**
- Modify: `web/src/components/GameSidebar.tsx`
- Modify: `web/src/components/GameSidebar.test.tsx`
- Modify: `web/src/styles.css`

- [ ] **Step 1: Write failing menu lane test**

Add to `GameSidebar.test.tsx`:

```tsx
it('shows all worker lanes in the analysis menu and boosts queued games', async () => {
  const user = userEvent.setup()
  const onBoostAnalysis = vi.fn().mockResolvedValue(undefined)
  const { container } = render(
    <GameSidebar
      games={[]}
      listOpen={false}
      selectedGameId="game-1"
      selectedAnalysisWorkerName="local-gpu"
      workerStatus={{ connected: 2, available: 2, busy: 1, workers: [
        { id: 'worker-1', name: 'local-gpu', platform: 'windows/amd64', model: 'kata1-b18c384nbt-s9996604416-d4316597426.bin.gz', maxVisits: 500, available: true, busy: true },
        { id: 'worker-2', name: 'remote-gpu', platform: 'linux/amd64', model: 'kata1-b28c512nbt-s13255194368-d5935380940.bin.gz', maxVisits: 300, available: true, busy: false },
      ] }}
      analysisSchedule={{ lanes: [
        {
          workerName: 'local-gpu',
          current: { id: 'run-1:main:3', kind: 'background', gameId: 'game-1', displayName: 'Lee vs Cho', nodeId: 'main:3', moveNumber: 3, workerName: 'local-gpu', analyzed: 3, total: 180, status: 'running', canBoost: false },
          highPriority: [{ id: 'trial-1', kind: 'trial', gameId: 'game-1', displayName: 'Lee vs Cho', nodeId: 'var:1', moveNumber: 4, workerName: 'local-gpu', analyzed: 0, total: 1, status: 'queued', canBoost: false }],
          queue: [{ id: 'run-2', kind: 'background', gameId: 'game-2', displayName: 'Alpha vs Beta', nodeId: 'main:0', workerName: 'local-gpu', analyzed: 0, total: 120, status: 'queued', canBoost: true }],
        },
        { workerName: 'remote-gpu', highPriority: [], queue: [] },
      ] }}
      analysisAvailable
      analysisState="running"
      analysisProgress={{ analyzed: 3, total: 180 }}
      onToggleList={vi.fn()}
      onImport={vi.fn()}
      onSelect={vi.fn()}
      onDelete={vi.fn()}
      onStartAnalysis={vi.fn()}
      onStopAnalysis={vi.fn()}
      onRestartAnalysis={vi.fn()}
      onBoostAnalysis={onBoostAnalysis}
    />,
  )

  const action = within(container).getByRole('button', { name: '打开分析菜单' })
  expect(action).toHaveAttribute('title', '当前棋局 3 / 180')
  await user.click(action)
  const menu = screen.getByRole('menu', { name: '分析' })
  expect(within(menu).getByText('local-gpu')).toBeInTheDocument()
  expect(within(menu).getByText('remote-gpu')).toBeInTheDocument()
  expect(within(menu).getByText('正在分析')).toBeInTheDocument()
  expect(within(menu).getByText('Lee vs Cho')).toBeInTheDocument()
  expect(within(menu).getByText('试下')).toBeInTheDocument()
  expect(within(menu).getByText('Alpha vs Beta')).toBeInTheDocument()
  await user.click(within(menu).getByRole('button', { name: '插队 Alpha vs Beta' }))
  expect(onBoostAnalysis).toHaveBeenCalledWith('game-2')
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- --run GameSidebar`

Expected: FAIL because `analysisSchedule` prop and lane UI are missing.

- [ ] **Step 3: Extend GameSidebar props**

In `GameSidebar.tsx`, update imports:

```ts
import type { AnalysisProgress, AnalysisSchedule, AnalysisScheduleTask, AnalysisState, GameRecord, WorkerStatus } from '../api/types'
```

Add props:

```ts
analysisSchedule?: AnalysisSchedule
onBoostAnalysis?(gameId: string): Promise<void>
```

Pass them into `AnalysisMenu`:

```tsx
analysisSchedule={analysisSchedule}
onBoostAnalysis={onBoostAnalysis}
```

- [ ] **Step 4: Set analysis button title**

In `AnalysisMenu`, compute:

```ts
const progressTitle = progressSpaced === '0 / 0' ? '当前棋局未分析' : `当前棋局 ${progressSpaced}`
```

Set on the trigger button:

```tsx
title={progressTitle}
```

- [ ] **Step 5: Add lane rendering component**

Add below the parameter block in `AnalysisMenu`:

```tsx
<AnalysisLaneList
  schedule={analysisSchedule}
  workerStatus={workerStatus}
  onBoostAnalysis={onBoostAnalysis}
/>
```

Add component:

```tsx
function AnalysisLaneList({
  schedule,
  workerStatus,
  onBoostAnalysis,
}: {
  schedule?: AnalysisSchedule
  workerStatus?: WorkerStatus
  onBoostAnalysis?(gameId: string): Promise<void>
}) {
  const lanes = schedule?.lanes ?? []
  const workers = workerStatus?.workers ?? []
  const knownNames = new Set(lanes.map((lane) => lane.workerName))
  const merged = [
    ...lanes,
    ...workers.flatMap((worker) => knownNames.has(worker.name) ? [] : [{ workerName: worker.name, highPriority: [], queue: [] }]),
  ]
  if (merged.length === 0) return <p className="analysis-lane-empty">暂无 Worker 队列</p>
  return (
    <section className="analysis-lanes" aria-label="Worker 分析队列">
      {merged.map((lane) => {
        const worker = workers.find((item) => item.name === lane.workerName)
        return (
          <article className="analysis-lane" key={lane.workerName}>
            <header className="analysis-lane-header">
              <strong>{lane.workerName}</strong>
              <span>{worker?.model || '-'}</span>
              <span>{worker?.maxVisits ? `${worker.maxVisits} visits` : '-'}</span>
            </header>
            {lane.current ? (
              <AnalysisTaskRow label="正在分析" task={lane.current} />
            ) : (
              <small className="analysis-lane-idle">空闲</small>
            )}
            {lane.highPriority.map((task) => (
              <AnalysisTaskRow key={task.id} label="试下" task={task} />
            ))}
            {lane.queue.map((task) => (
              <AnalysisTaskRow key={task.id} label="排队" task={task} onBoostAnalysis={task.canBoost ? onBoostAnalysis : undefined} />
            ))}
          </article>
        )
      })}
    </section>
  )
}
```

Add row:

```tsx
function AnalysisTaskRow({
  label,
  task,
  onBoostAnalysis,
}: {
  label: string
  task: AnalysisScheduleTask
  onBoostAnalysis?(gameId: string): Promise<void>
}) {
  return (
    <div className="analysis-task-row">
      <span className="analysis-task-kind">{label}</span>
      <span className="analysis-task-main">
        <strong title={task.displayName}>{task.displayName}</strong>
        <small>{taskProgress(task)}</small>
      </span>
      {onBoostAnalysis && (
        <button type="button" onClick={() => void onBoostAnalysis(task.gameId)} aria-label={`插队 ${task.displayName}`}>
          插队
        </button>
      )}
    </div>
  )
}

function taskProgress(task: AnalysisScheduleTask) {
  if (task.kind === 'trial') return task.nodeId || '试下'
  return `${task.analyzed} / ${task.total}`
}
```

- [ ] **Step 6: Add menu CSS**

In `web/src/styles.css`, add compact styles near existing `.analysis-menu` block:

```css
.analysis-lanes {
  display: grid;
  gap: 8px;
  max-height: min(48vh, 420px);
  overflow: auto;
}

.analysis-lane {
  display: grid;
  gap: 6px;
  padding: 8px;
  border: 1px solid rgba(36, 34, 30, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.72);
}

.analysis-lane-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
  font-size: 12px;
}

.analysis-lane-header strong,
.analysis-task-main strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.analysis-task-row {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  min-height: 30px;
  font-size: 12px;
}

.analysis-task-kind {
  color: #6f6a61;
}

.analysis-task-main {
  display: grid;
  min-width: 0;
}

.analysis-task-main small,
.analysis-lane-idle,
.analysis-lane-empty {
  color: #7d776d;
  font-size: 11px;
}
```

- [ ] **Step 7: Run component tests**

Run: `npm test -- --run GameSidebar`

Expected: PASS.

- [ ] **Step 8: Run frontend build**

Run: `npm run build`

Expected: PASS with the existing Vite chunk-size warning only.

- [ ] **Step 9: Commit frontend changes**

```powershell
git add web/src/api/types.ts web/src/App.tsx web/src/components/GameSidebar.tsx web/src/components/GameSidebar.test.tsx web/src/styles.css
git commit -m "feat: show analysis worker lanes"
```

---

### Task 7: Full Verification and Deployment

**Files:**
- No source file changes expected.

- [ ] **Step 1: Run full backend tests**

Run: `go test ./...`

Expected: all packages PASS.

- [ ] **Step 2: Run full frontend tests**

Run:

```powershell
cd web
npm test -- --run
```

Expected: all tests PASS. The existing `--localstorage-file` warning is acceptable if tests pass.

- [ ] **Step 3: Run frontend build**

Run:

```powershell
cd web
npm run build
```

Expected: build exits 0. The existing Vite chunk-size warning is acceptable.

- [ ] **Step 4: Deploy**

Run:

```powershell
.\deploy.bat
```

Expected: `[OK] deploy complete`.

- [ ] **Step 5: Start runtime and verify processes**

Run:

```powershell
& $HOME\.jcgo\start.bat
Get-Process jcgo,jcgo-worker,katago -ErrorAction SilentlyContinue | Select-Object ProcessName,Id,Path
```

Expected: `jcgo.exe` and `jcgo-worker.exe` are listed. `katago.exe` may appear immediately or after the worker initializes KataGo.

- [ ] **Step 6: Final commit if verification required generated changes**

If deployment or formatting changed tracked files, commit them:

```powershell
git status --short
git add -A
git commit -m "chore: verify analysis scheduler UI"
```

If `git status --short` is clean, skip this commit.

- [ ] **Step 7: Push**

Run:

```powershell
git push origin master
```

Expected: push succeeds.
