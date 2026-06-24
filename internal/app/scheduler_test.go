package app

import (
	"context"
	"testing"
	"time"

	"jcgo/internal/game"
	"jcgo/internal/katago"
)

type fakeAnalyzer struct {
	calls []string
}

func (f *fakeAnalyzer) Analyze(ctx context.Context, query katago.Query) (katago.Result, error) {
	f.calls = append(f.calls, query.ID)
	return katago.Result{
		ID:       query.ID,
		RootInfo: katago.RootInfo{Visits: 500, Winrate: 0.5, ScoreLead: 0},
		MoveInfos: []katago.MoveInfo{
			{Move: "Q16", Order: 0, Visits: 500, Winrate: 0.5, ScoreLead: 0},
		},
	}, nil
}

func (f *fakeAnalyzer) Available() bool { return true }
func (f *fakeAnalyzer) Status() katago.Status {
	return katago.Status{Available: true}
}
func (f *fakeAnalyzer) Close() error { return nil }

func TestSchedulerPublishesAnalysisEvents(t *testing.T) {
	engine := &fakeAnalyzer{}
	scheduler := NewScheduler(engine, 500)
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
