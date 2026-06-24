package app

import (
	"testing"

	"jcgo/internal/game"
)

func TestWorkspaceStoreRecoversSameTokenState(t *testing.T) {
	store := NewWorkspaceStore()
	ws1 := store.ForToken("secret")
	ws2 := store.ForToken("secret")
	if ws1 != ws2 {
		t.Fatal("same token did not return same workspace")
	}
}

func TestVariationSurvivesReconnectInProcess(t *testing.T) {
	doc, err := game.ParseSGF(`(;GM[1]FF[4]SZ[19];B[pd];W[dd])`)
	if err != nil {
		t.Fatal(err)
	}
	store := NewWorkspaceStore()
	ws := store.ForToken("secret")
	if err := ws.LoadGame("game-1", doc); err != nil {
		t.Fatal(err)
	}
	if _, err := ws.Play("game-1", "D4"); err != nil {
		t.Fatal(err)
	}

	reconnected := store.ForToken("secret")
	snap, err := reconnected.CurrentSnapshot("game-1")
	if err != nil {
		t.Fatal(err)
	}
	if snap.BranchMode != "variation" || !snap.CanBackToMain || snap.MoveNumber != 1 {
		t.Fatalf("snapshot = %#v", snap)
	}
}

func TestWorkspaceStoresAnalysisOnSnapshot(t *testing.T) {
	doc, err := game.ParseSGF(`(;GM[1]FF[4]SZ[19];B[pd])`)
	if err != nil {
		t.Fatal(err)
	}
	ws := NewWorkspaceStore().ForToken("secret")
	if err := ws.LoadGame("game-1", doc); err != nil {
		t.Fatal(err)
	}
	ws.SetAnalysis("game-1", "main:0", game.AnalysisResult{
		Visits:     500,
		Candidates: []game.CandidateMove{{Move: "Q16"}},
	})
	snap, err := ws.CurrentSnapshot("game-1")
	if err != nil {
		t.Fatal(err)
	}
	if snap.Analysis == nil || len(snap.Analysis.Candidates) != 1 {
		t.Fatalf("snapshot = %#v", snap)
	}
	inputs := ws.MainlineAnalysisInputs("game-1")
	if len(inputs) != 2 || inputs[1].NodeID != "main:1" {
		t.Fatalf("inputs = %#v", inputs)
	}
}

func TestAnalysisViewOnlyReturnsContiguousChartFromMoveZero(t *testing.T) {
	doc, err := game.ParseSGF(`(;GM[1]FF[4]SZ[19];B[pd];W[dd])`)
	if err != nil {
		t.Fatal(err)
	}
	ws := NewWorkspaceStore().ForToken("secret")
	if err := ws.LoadGame("game-1", doc); err != nil {
		t.Fatal(err)
	}
	ws.SetAnalysis("game-1", "main:1", game.AnalysisResult{Winrate: 0.56})

	points, badMoves, _, err := ws.AnalysisView("game-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(points) != 0 || len(badMoves) != 0 {
		t.Fatalf("analysis view = %#v %#v", points, badMoves)
	}
}

func TestAnalysisViewUsesPlayedMovePointLossLikeKaTrain(t *testing.T) {
	doc, err := game.ParseSGF(`(;GM[1]FF[4]SZ[19];B[pd];W[dd])`)
	if err != nil {
		t.Fatal(err)
	}
	ws := NewWorkspaceStore().ForToken("secret")
	if err := ws.LoadGame("game-1", doc); err != nil {
		t.Fatal(err)
	}
	ws.SetAnalysis("game-1", "main:0", game.AnalysisResult{
		ScoreLead: 2.0,
		Candidates: []game.CandidateMove{
			{Move: "Q16", Order: 0, PointLoss: 0},
			{Move: "D4", Order: 1, PointLoss: 12},
		},
	})
	ws.SetAnalysis("game-1", "main:1", game.AnalysisResult{
		ScoreLead: -1.5,
		Candidates: []game.CandidateMove{
			{Move: "D4", Order: 0, PointLoss: 0},
		},
	})
	ws.SetAnalysis("game-1", "main:2", game.AnalysisResult{
		ScoreLead: -2.5,
		Candidates: []game.CandidateMove{
			{Move: "Q4", Order: 0, PointLoss: 0},
		},
	})

	_, badMoves, _, err := ws.AnalysisView("game-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(badMoves) != 1 {
		t.Fatalf("bad moves = %#v", badMoves)
	}
	got := badMoves[0]
	if got.NodeID != "main:1" || got.MoveNumber != 1 || got.Move != "Q16" || got.Color != game.Black || got.PointLoss != 3.5 {
		t.Fatalf("bad move = %#v", got)
	}
}
