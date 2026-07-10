package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"jcgo/internal/game"
	"jcgo/internal/katago"
)

type fakeAnalyzer struct {
	calls   []string
	queries []katago.Query
}

func (f *fakeAnalyzer) Analyze(ctx context.Context, query katago.Query) (katago.Result, error) {
	f.calls = append(f.calls, query.ID)
	f.queries = append(f.queries, query)
	return katago.Result{
		ID:       query.ID,
		RootInfo: katago.RootInfo{Visits: 500, Winrate: 0.5, ScoreLead: 0},
		Policy:   []float64{0.2, 0.8},
		MoveInfos: []katago.MoveInfo{
			{Move: "Q16", Order: 0, Visits: 500, Winrate: 0.5, ScoreLead: 0},
		},
	}, nil
}

func (f *fakeAnalyzer) AnalyzeWithWorker(ctx context.Context, workerName string, query katago.Query) (katago.Result, error) {
	return f.Analyze(ctx, query)
}

func (f *fakeAnalyzer) Available() bool { return true }
func (f *fakeAnalyzer) Status() katago.Status {
	return katago.Status{Available: true}
}
func (f *fakeAnalyzer) Close() error { return nil }

type fakeErrorAnalyzer struct {
	fakeAnalyzer
}

func (f *fakeErrorAnalyzer) Analyze(ctx context.Context, query katago.Query) (katago.Result, error) {
	f.calls = append(f.calls, query.ID)
	return katago.Result{}, errors.New("bad komi")
}

type fakeProgressAnalyzer struct {
	fakeAnalyzer
}

func (f *fakeProgressAnalyzer) AnalyzeWithProgress(ctx context.Context, query katago.Query, progress func(katago.Result)) (katago.Result, error) {
	f.calls = append(f.calls, query.ID)
	progress(katago.Result{
		ID:             query.ID,
		IsDuringSearch: true,
		RootInfo:       katago.RootInfo{Visits: 37, Winrate: 0.48, ScoreLead: -1.2},
		MoveInfos: []katago.MoveInfo{
			{Move: "D4", Order: 0, Visits: 37, Winrate: 0.48, ScoreLead: -1.2},
		},
	})
	return katago.Result{
		ID:       query.ID,
		RootInfo: katago.RootInfo{Visits: 500, Winrate: 0.5, ScoreLead: 0},
		MoveInfos: []katago.MoveInfo{
			{Move: "Q16", Order: 0, Visits: 500, Winrate: 0.5, ScoreLead: 0},
		},
	}, nil
}

type fakeWorkerBoundAnalyzer struct {
	fakeAnalyzer
	workerNames []string
}

func (f *fakeWorkerBoundAnalyzer) AnalyzeWithWorkerProgress(ctx context.Context, workerName string, query katago.Query, progress func(katago.Result)) (katago.Result, error) {
	f.calls = append(f.calls, query.ID)
	f.workerNames = append(f.workerNames, workerName)
	progress(katago.Result{
		ID:             query.ID,
		IsDuringSearch: true,
		RootInfo:       katago.RootInfo{Visits: 33, Winrate: 0.47, ScoreLead: -0.6},
		MoveInfos: []katago.MoveInfo{
			{Move: "C4", Order: 0, Visits: 33, Winrate: 0.47, ScoreLead: -0.6},
		},
	})
	return katago.Result{
		ID:       query.ID,
		RootInfo: katago.RootInfo{Visits: 600, Winrate: 0.52, ScoreLead: 1.4},
		MoveInfos: []katago.MoveInfo{
			{Move: "R16", Order: 0, Visits: 600, Winrate: 0.52, ScoreLead: 1.4},
		},
	}, nil
}

type cancellableWorkerAnalyzer struct {
	started     chan struct{}
	cancelled   chan error
	release     chan struct{}
	workerNames []string
}

func (f *cancellableWorkerAnalyzer) Analyze(ctx context.Context, query katago.Query) (katago.Result, error) {
	return katago.Result{}, errors.New("unexpected unbound analysis")
}

func (f *cancellableWorkerAnalyzer) AnalyzeWithWorkerProgress(ctx context.Context, workerName string, query katago.Query, progress func(katago.Result)) (katago.Result, error) {
	f.workerNames = append(f.workerNames, workerName)
	close(f.started)
	select {
	case <-ctx.Done():
		f.cancelled <- ctx.Err()
		return katago.Result{}, ctx.Err()
	case <-f.release:
		return katago.Result{ID: query.ID, RootInfo: katago.RootInfo{Visits: 1}}, nil
	}
}

func (f *cancellableWorkerAnalyzer) Available() bool { return true }

func (f *cancellableWorkerAnalyzer) Status() katago.Status {
	return katago.Status{Available: true}
}

func (f *cancellableWorkerAnalyzer) Close() error { return nil }

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

func TestSchedulerPublishesAnalysisEvents(t *testing.T) {
	engine := &fakeAnalyzer{}
	scheduler := NewScheduler(engine)
	defer scheduler.Close()

	received := make(chan Event, 1)
	scheduler.Subscribe(func(event Event) { received <- event })
	scheduler.StartGame(StartInput{
		Token:       "secret",
		GameID:      "game-1",
		FocusNodeID: "main:0",
		Nodes: []NodeInput{
			{NodeID: "main:0", MoveNumber: 0, ToPlay: game.Black, Rules: "chinese", Komi: 7.5},
		},
	})

	select {
	case event := <-received:
		if event.Token != "secret" || event.GameID != "game-1" || event.NodeID != "main:0" {
			t.Fatalf("event = %#v", event)
		}
		if len(event.Analysis.Candidates) != 1 || event.Analysis.Candidates[0].Move != "Q16" {
			t.Fatalf("analysis = %#v", event.Analysis)
		}
	case <-time.After(time.Second):
		t.Fatal("expected analysis event")
	}
	if len(engine.calls) != 1 {
		t.Fatalf("calls = %v", engine.calls)
	}
}

func TestSchedulerUsesStartInputWorkerName(t *testing.T) {
	engine := &fakeWorkerBoundAnalyzer{}
	scheduler := NewScheduler(engine)
	defer scheduler.Close()

	received := make(chan Event, 2)
	scheduler.Subscribe(func(event Event) { received <- event })
	scheduler.StartGame(StartInput{
		Token:       "secret",
		GameID:      "game-1",
		FocusNodeID: "main:0",
		WorkerName:  "gpu-1",
		Nodes: []NodeInput{
			{NodeID: "main:0", MoveNumber: 0, ToPlay: game.Black, Rules: "chinese", Komi: 7.5},
		},
	})

	progress := waitSchedulerEvent(t, received)
	if !progress.IsDuringSearch || progress.Analysis.Root.Visits != 33 {
		t.Fatalf("progress event = %#v", progress)
	}
	final := waitSchedulerEvent(t, received)
	if final.Analysis.Root.Visits != 600 || final.Analysis.Candidates[0].Move != "R16" {
		t.Fatalf("final event = %#v", final)
	}
	if len(engine.workerNames) != 1 || engine.workerNames[0] != "gpu-1" {
		t.Fatalf("workerNames = %v", engine.workerNames)
	}
	if len(engine.calls) != 1 || engine.calls[0] != "main:0" {
		t.Fatalf("calls = %v", engine.calls)
	}
}

func TestSchedulerStopCancelsInFlightWorkerAnalysis(t *testing.T) {
	engine := &cancellableWorkerAnalyzer{
		started:   make(chan struct{}),
		cancelled: make(chan error, 1),
		release:   make(chan struct{}),
	}
	scheduler := NewScheduler(engine)
	defer scheduler.Close()
	defer close(engine.release)

	scheduler.StartGame(StartInput{
		Token:       "secret",
		GameID:      "game-1",
		FocusNodeID: "main:0",
		WorkerName:  "gpu-1",
		Nodes: []NodeInput{
			{NodeID: "main:0", MoveNumber: 0, ToPlay: game.Black, Rules: "chinese", Komi: 7.5},
		},
	})

	select {
	case <-engine.started:
	case <-time.After(time.Second):
		t.Fatal("expected analysis to start")
	}
	scheduler.StopGame("secret", "game-1")

	select {
	case err := <-engine.cancelled:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancel error = %v", err)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("analysis context was not cancelled")
	}
	if len(engine.workerNames) != 1 || engine.workerNames[0] != "gpu-1" {
		t.Fatalf("workerNames = %v", engine.workerNames)
	}
}

func TestSchedulerBuildsQueriesWithPolicyAndInitialPlayer(t *testing.T) {
	engine := &fakeAnalyzer{}
	scheduler := NewScheduler(engine)
	defer scheduler.Close()

	received := make(chan Event, 1)
	scheduler.Subscribe(func(event Event) { received <- event })
	scheduler.StartGame(StartInput{
		Token:       "secret",
		GameID:      "game-1",
		FocusNodeID: "main:0",
		Nodes: []NodeInput{
			{NodeID: "main:0", MoveNumber: 0, ToPlay: game.White, InitialPlayer: game.White, Rules: "chinese", Komi: 7.5},
		},
	})
	_ = waitSchedulerEvent(t, received)

	if len(engine.queries) != 1 {
		t.Fatalf("queries = %#v", engine.queries)
	}
	query := engine.queries[0]
	if query.InitialPlayer != "W" || !query.IncludePolicy || query.MaxVisits != 0 {
		t.Fatalf("query = %#v", query)
	}
}

func TestSchedulerPublishesSearchProgressEvents(t *testing.T) {
	engine := &fakeProgressAnalyzer{}
	scheduler := NewScheduler(engine)
	defer scheduler.Close()

	received := make(chan Event, 2)
	scheduler.Subscribe(func(event Event) { received <- event })
	scheduler.StartGame(StartInput{
		Token:       "secret",
		GameID:      "game-1",
		FocusNodeID: "main:0",
		Nodes: []NodeInput{
			{NodeID: "main:0", MoveNumber: 0, ToPlay: game.Black, Rules: "chinese", Komi: 7.5},
		},
	})

	first := waitSchedulerEvent(t, received)
	if first.Analysis.Root.Visits != 37 || first.Analysis.Candidates[0].Move != "D4" {
		t.Fatalf("progress event analysis = %#v", first.Analysis)
	}
	second := waitSchedulerEvent(t, received)
	if second.Analysis.Root.Visits != 500 || second.Analysis.Candidates[0].Move != "Q16" {
		t.Fatalf("final event analysis = %#v", second.Analysis)
	}
}

func TestSchedulerPublishesAnalysisError(t *testing.T) {
	engine := &fakeErrorAnalyzer{}
	scheduler := NewScheduler(engine)
	defer scheduler.Close()

	received := make(chan Event, 1)
	scheduler.Subscribe(func(event Event) { received <- event })
	scheduler.StartGame(StartInput{
		Token:       "secret",
		GameID:      "game-1",
		FocusNodeID: "main:0",
		Nodes: []NodeInput{
			{NodeID: "main:0", MoveNumber: 0, ToPlay: game.Black, Rules: "chinese", Komi: 3.8},
		},
	})

	event := waitSchedulerEvent(t, received)
	if event.Token != "secret" || event.GameID != "game-1" || event.NodeID != "main:0" {
		t.Fatalf("event = %#v", event)
	}
	if event.Error != "bad komi" {
		t.Fatalf("error = %q", event.Error)
	}
	if len(engine.calls) != 1 {
		t.Fatalf("calls = %v", engine.calls)
	}
}

func waitSchedulerEvent(t *testing.T, received <-chan Event) Event {
	t.Helper()
	select {
	case event := <-received:
		return event
	case <-time.After(time.Second):
		t.Fatal("expected scheduler event")
		return Event{}
	}
}
