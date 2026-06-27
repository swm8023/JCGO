package app

import (
	"encoding/base64"
	"encoding/json"
	"testing"

	"jcgo/internal/game"
)

func TestStatePayloadUsesFixedColumnarMainTimeline(t *testing.T) {
	ws := newWorkspace()
	doc, err := game.ParseSGF(`(;GM[1]FF[4]SZ[19]KM[7.5]RU[chinese]PB[B]PW[W]RE[B+R];B[pd];W[dd])`)
	if err != nil {
		t.Fatal(err)
	}
	if err := ws.LoadGame("game-1", doc); err != nil {
		t.Fatal(err)
	}
	ws.SetAnalysis("game-1", "main:0", game.AnalysisResult{
		Root:        game.RootAnalysis{Winrate: 0.52, ScoreLead: 1.4, Visits: 100},
		Candidates:  []game.CandidateRaw{{Move: "Q16", Order: 0, Visits: 90, Winrate: 0.53, ScoreLead: 1.8, PV: []string{"Q16"}}},
		OwnershipQ8: []byte{1, 2, 3},
	})
	state, err := ws.StatePayload("game-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Timeline.NodeIDs) != 3 || state.Timeline.NodeIDs[2] != "main:2" {
		t.Fatalf("node ids = %#v", state.Timeline.NodeIDs)
	}
	if state.Timeline.RootWinrates[0] == nil || *state.Timeline.RootWinrates[0] != 0.52 {
		t.Fatalf("root winrate[0] = %#v", state.Timeline.RootWinrates[0])
	}
	if state.Timeline.RootWinrates[1] != nil {
		t.Fatalf("root winrate[1] = %#v", state.Timeline.RootWinrates[1])
	}
	if state.Current.NodeID != "main:0" || state.Current.Candidates.Moves[0] != "Q16" {
		t.Fatalf("current = %#v", state.Current)
	}
	if state.Current.Ownership == nil || state.Current.Ownership.Data != base64.StdEncoding.EncodeToString([]byte{1, 2, 3}) {
		t.Fatalf("ownership = %#v", state.Current.Ownership)
	}
}

func TestStatePayloadIncludesVariationTimelineAndExcludesVariationBadMoves(t *testing.T) {
	ws := newWorkspace()
	doc, err := game.ParseSGF(`(;GM[1]FF[4]SZ[19]KM[7.5]RU[chinese];B[pd])`)
	if err != nil {
		t.Fatal(err)
	}
	if err := ws.LoadGame("game-1", doc); err != nil {
		t.Fatal(err)
	}
	if _, err := ws.GotoMain("game-1", 0); err != nil {
		t.Fatal(err)
	}
	snap, err := ws.Play("game-1", "D4")
	if err != nil {
		t.Fatal(err)
	}
	ws.SetAnalysis("game-1", snap.NodeID, game.AnalysisResult{Root: game.RootAnalysis{Winrate: 0.60, ScoreLead: 3.0, Visits: 50}})
	state, err := ws.StatePayload("game-1")
	if err != nil {
		t.Fatal(err)
	}
	if state.Variation == nil || state.Variation.BaseMoveNumber != 0 || state.Variation.Timeline.NodeIDs[0] != snap.NodeID {
		t.Fatalf("variation = %#v", state.Variation)
	}
	if len(state.BadMoves.PointLosses) != 0 {
		t.Fatalf("variation polluted bad moves = %#v", state.BadMoves)
	}
}

func TestStatePayloadExcludesOccupiedCurrentCandidates(t *testing.T) {
	ws := newWorkspace()
	doc, err := game.ParseSGF(`(;GM[1]FF[4]SZ[19]KM[7.5]RU[chinese];B[pd])`)
	if err != nil {
		t.Fatal(err)
	}
	if err := ws.LoadGame("game-1", doc); err != nil {
		t.Fatal(err)
	}
	if _, err := ws.GotoMain("game-1", 1); err != nil {
		t.Fatal(err)
	}
	ws.SetAnalysis("game-1", "main:1", game.AnalysisResult{
		Root: game.RootAnalysis{Winrate: 0.52, ScoreLead: 1.4, Visits: 100},
		Candidates: []game.CandidateRaw{
			{Move: "Q16", Order: 0, Visits: 100, Winrate: 0.52, ScoreLead: 1.4},
			{Move: "D4", Order: 1, Visits: 50, Winrate: 0.50, ScoreLead: 1.0},
		},
	})

	state, err := ws.StatePayload("game-1")
	if err != nil {
		t.Fatal(err)
	}
	if got := state.Current.Candidates.Moves; len(got) != 1 || got[0] != "D4" {
		t.Fatalf("candidate moves = %#v, want only D4", got)
	}
}

func TestStatePayloadJSONUsesEmptyArraysForMissingColumns(t *testing.T) {
	ws := newWorkspace()
	doc, err := game.ParseSGF(`(;GM[1]FF[4]SZ[19]KM[7.5]RU[chinese])`)
	if err != nil {
		t.Fatal(err)
	}
	if err := ws.LoadGame("game-1", doc); err != nil {
		t.Fatal(err)
	}
	state, err := ws.StatePayload("game-1")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}

	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if _, ok := decoded["games"].([]any); !ok {
		t.Fatalf("games encoded as %T (%#v), want JSON array", decoded["games"], decoded["games"])
	}
	assertJSONArray(t, decoded["snapshot"].(map[string]any), "stones")
	assertJSONArray(t, decoded["badMoves"].(map[string]any), "nodeIds")
	assertJSONArray(t, decoded["badMoves"].(map[string]any), "moves")
	assertJSONArray(t, decoded["current"].(map[string]any)["candidates"].(map[string]any), "moves")
	assertJSONArray(t, decoded["current"].(map[string]any)["candidates"].(map[string]any), "pvs")
}

func assertJSONArray(t *testing.T, obj map[string]any, key string) {
	t.Helper()
	if _, ok := obj[key].([]any); !ok {
		t.Fatalf("%s encoded as %T (%#v), want JSON array", key, obj[key], obj[key])
	}
}
