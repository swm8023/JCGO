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
