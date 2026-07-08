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
		Root:       game.RootAnalysis{Visits: 500},
		Candidates: []game.CandidateRaw{{Move: "Q16"}},
	})
	snap, err := ws.CurrentSnapshot("game-1")
	if err != nil {
		t.Fatal(err)
	}
	state, err := ws.StatePayload("game-1")
	if err != nil {
		t.Fatal(err)
	}
	if state.Current.NodeID != snap.NodeID || len(state.Current.Candidates.Moves) != 1 {
		t.Fatalf("state current = %#v", state.Current)
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
	ws.SetAnalysis("game-1", "main:1", game.AnalysisResult{Root: game.RootAnalysis{Winrate: 0.56}})

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
		Root: game.RootAnalysis{ScoreLead: 2.0},
		Candidates: []game.CandidateRaw{
			{Move: "Q16", Order: 0},
			{Move: "D4", Order: 1},
		},
	})
	ws.SetAnalysis("game-1", "main:1", game.AnalysisResult{
		Root: game.RootAnalysis{ScoreLead: -1.5},
		Candidates: []game.CandidateRaw{
			{Move: "D4", Order: 0},
		},
	})
	ws.SetAnalysis("game-1", "main:2", game.AnalysisResult{
		Root: game.RootAnalysis{ScoreLead: -2.5},
		Candidates: []game.CandidateRaw{
			{Move: "Q4", Order: 0},
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

func TestWorkspaceMarksAnalysisUnavailableOnError(t *testing.T) {
	doc, err := game.ParseSGF(`(;GM[1]FF[4]SZ[19];B[pd])`)
	if err != nil {
		t.Fatal(err)
	}
	ws := NewWorkspaceStore().ForToken("secret")
	if err := ws.LoadGame("game-1", doc); err != nil {
		t.Fatal(err)
	}
	ws.MarkAnalysisStarted("game-1")
	ws.SetAnalysisError("game-1", "bad komi")

	if state := ws.AnalysisState("game-1"); state != AnalysisUnavailable {
		t.Fatalf("analysis state = %s", state)
	}
	if err := ws.AnalysisError("game-1"); err != "bad komi" {
		t.Fatalf("analysis error = %q", err)
	}
}

func TestClearVariationPreservesMainlineAnalysisAndState(t *testing.T) {
	doc, err := game.ParseSGF(`(;GM[1]FF[4]SZ[19];B[pd])`)
	if err != nil {
		t.Fatal(err)
	}
	ws := NewWorkspaceStore().ForToken("secret")
	if err := ws.LoadGame("game-1", doc); err != nil {
		t.Fatal(err)
	}
	ws.SetAnalysis("game-1", "main:0", game.AnalysisResult{Root: game.RootAnalysis{Winrate: 0.52}, Candidates: []game.CandidateRaw{{Move: "Q16"}}})
	ws.SetAnalysis("game-1", "main:1", game.AnalysisResult{Root: game.RootAnalysis{Winrate: 0.48}, Candidates: []game.CandidateRaw{{Move: "D4"}}})
	if _, err := ws.Play("game-1", "D4"); err != nil {
		t.Fatal(err)
	}
	ws.SetAnalysis("game-1", "var:1", game.AnalysisResult{Root: game.RootAnalysis{Winrate: 0.50}, Candidates: []game.CandidateRaw{{Move: "Q4"}}})

	snap, err := ws.ClearVariation("game-1")
	if err != nil {
		t.Fatal(err)
	}
	if snap.NodeID != "main:0" {
		t.Fatalf("snapshot after clear = %#v", snap)
	}
	payload, err := ws.StatePayload("game-1")
	if err != nil {
		t.Fatal(err)
	}
	if payload.Current.NodeID != "main:0" || payload.Timeline.RootWinrates[0] == nil || *payload.Timeline.RootWinrates[0] != 0.52 {
		t.Fatalf("payload after clear = %#v", payload)
	}
	points, _, state, err := ws.AnalysisView("game-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(points) != 2 || state != AnalysisComplete {
		t.Fatalf("analysis after clear = points %#v, state %s", points, state)
	}
}

func TestVariationAnalysisDoesNotChangeMainlineAnalysisState(t *testing.T) {
	doc, err := game.ParseSGF(`(;GM[1]FF[4]SZ[19];B[pd])`)
	if err != nil {
		t.Fatal(err)
	}
	ws := NewWorkspaceStore().ForToken("secret")
	if err := ws.LoadGame("game-1", doc); err != nil {
		t.Fatal(err)
	}
	if _, err := ws.Play("game-1", "D4"); err != nil {
		t.Fatal(err)
	}
	ws.SetAnalysis("game-1", "var:1", game.AnalysisResult{Root: game.RootAnalysis{Winrate: 0.50}, Candidates: []game.CandidateRaw{{Move: "Q4"}}})

	points, _, state, err := ws.AnalysisView("game-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(points) != 0 || state != AnalysisIdle {
		t.Fatalf("mainline analysis view = points %#v, state %s", points, state)
	}
	snap, err := ws.CurrentSnapshot("game-1")
	if err != nil {
		t.Fatal(err)
	}
	if snap.NodeID != "var:1" {
		t.Fatalf("variation snapshot = %#v", snap)
	}
	payload, err := ws.StatePayload("game-1")
	if err != nil {
		t.Fatal(err)
	}
	if payload.Current.NodeID != "var:1" || len(payload.Current.Candidates.Moves) != 1 {
		t.Fatalf("variation payload = %#v", payload.Current)
	}
}
