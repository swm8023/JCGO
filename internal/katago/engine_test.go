package katago

import (
	"context"
	"testing"
)

func TestBuildQueryUsesBlackPerspectiveAndInitialStones(t *testing.T) {
	query := BuildQuery(BuildInput{
		ID:            "q-1",
		Rules:         "chinese",
		Komi:          7.5,
		MaxVisits:     500,
		InitialStones: []Stone{{Player: "B", Move: "D16"}},
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
	if !query.IncludePolicy || query.InitialPlayer != "B" || query.BoardXSize != 19 || query.BoardYSize != 19 {
		t.Fatalf("query flags = %#v", query)
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
