package katago

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestBuildQueryUsesBlackPerspectiveInitialPlayerAndInitialStones(t *testing.T) {
	query := BuildQuery(BuildInput{
		ID:            "q-1",
		Rules:         "chinese",
		Komi:          7.5,
		MaxVisits:     500,
		InitialStones: []Stone{{Player: "B", Move: "D16"}},
		InitialPlayer: "W",
		Moves:         []Move{{Player: "B", Move: "Q16"}},
		AnalyzeTurn:   1,
	})
	if query.Rules != "chinese" || query.Komi != 7.5 || query.MaxVisits != 500 {
		t.Fatalf("query = %#v", query)
	}
	if len(query.InitialStones) != 1 || query.InitialStones[0][1] != "D16" {
		t.Fatalf("initial stones = %#v", query.InitialStones)
	}
	if len(query.Moves) != 1 || query.Moves[0][1] != "Q16" {
		t.Fatalf("moves = %#v", query.Moves)
	}
	if !query.IncludeOwnership || !query.IncludePolicy || query.IncludeMovesOwnership || query.InitialPlayer != "W" || query.BoardXSize != 19 || query.BoardYSize != 19 {
		t.Fatalf("query flags = %#v", query)
	}
	if query.ReportDuringSearchEvery != 1 {
		t.Fatalf("ReportDuringSearchEvery = %v, want 1", query.ReportDuringSearchEvery)
	}
	raw, err := json.Marshal(query)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), `"initialStones":null`) || strings.Contains(string(raw), `"moves":null`) {
		t.Fatalf("query JSON contains null arrays: %s", raw)
	}
}

func TestBuildQueryRequestsOwnershipAndPolicy(t *testing.T) {
	query := BuildQuery(BuildInput{
		ID:          "main:0",
		Rules:       "chinese",
		Komi:        7.5,
		MaxVisits:   500,
		AnalyzeTurn: 0,
	})
	if !query.IncludeOwnership {
		t.Fatal("IncludeOwnership = false")
	}
	if !query.IncludePolicy {
		t.Fatal("IncludePolicy = false")
	}
	if query.IncludeMovesOwnership {
		t.Fatal("IncludeMovesOwnership = true")
	}
}

func TestBuildQueryEncodesEmptyListsAsArrays(t *testing.T) {
	query := BuildQuery(BuildInput{
		ID:          "root",
		Rules:       "chinese",
		Komi:        7.5,
		MaxVisits:   500,
		AnalyzeTurn: 0,
	})
	raw, err := json.Marshal(query)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), `"initialStones":null`) || strings.Contains(string(raw), `"moves":null`) {
		t.Fatalf("query JSON contains null arrays: %s", raw)
	}
}

func TestResultParsesOwnership(t *testing.T) {
	data := []byte(`{"id":"main:0","rootInfo":{"visits":10,"winrate":0.5,"scoreLead":1.2},"moveInfos":[],"ownership":[1,-1,0.5],"policy":[0.1,0.9]}`)
	var result Result
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Ownership) != 3 || result.Ownership[0] != 1 || result.Ownership[1] != -1 || result.Ownership[2] != 0.5 {
		t.Fatalf("ownership = %#v", result.Ownership)
	}
	if len(result.Policy) != 2 || result.Policy[0] != 0.1 || result.Policy[1] != 0.9 {
		t.Fatalf("policy = %#v", result.Policy)
	}
}

func TestUnavailableEngineReturnsError(t *testing.T) {
	engine := NewUnavailable("missing katago")
	if engine.Available() {
		t.Fatal("Available = true")
	}
	if engine.Status().Error != "missing katago" {
		t.Fatalf("status = %#v", engine.Status())
	}
	_, err := engine.Analyze(context.Background(), Query{ID: "q-1"})
	if err == nil {
		t.Fatal("Analyze returned nil error")
	}
}
