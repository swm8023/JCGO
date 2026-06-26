package game

import (
	"bytes"
	"testing"

	"jcgo/internal/katago"
)

func TestNormalizeAnalysisKeepsRawRootAndOrdersCandidates(t *testing.T) {
	out := NormalizeAnalysis(Black, katago.Result{
		RootInfo: katago.RootInfo{Winrate: 0.55, ScoreLead: 3.0, Visits: 500},
		MoveInfos: []katago.MoveInfo{
			{Move: "D4", Order: 1, Visits: 80, Winrate: 0.50, ScoreLead: 1.0, PV: []string{"D4"}},
			{Move: "Q16", Order: 0, Visits: 400, Winrate: 0.56, ScoreLead: 3.4, PV: []string{"Q16", "D16"}},
		},
	})
	if out.Root.Winrate != 0.55 || out.Root.ScoreLead != 3.0 || out.Root.Visits != 500 {
		t.Fatalf("root = %#v", out.Root)
	}
	if out.Candidates[0].Move != "Q16" || out.Candidates[0].Order != 0 {
		t.Fatalf("candidate[0] = %#v", out.Candidates[0])
	}
}

func TestNormalizeAnalysisDoesNotMutateCandidatePV(t *testing.T) {
	pv := []string{"D4", "Q16"}
	out := NormalizeAnalysis(White, katago.Result{
		RootInfo: katago.RootInfo{Winrate: 0.45, ScoreLead: -2.0, Visits: 500},
		MoveInfos: []katago.MoveInfo{
			{Move: "D4", Order: 0, Visits: 400, Winrate: 0.44, ScoreLead: -2.5, PV: pv},
		},
	})
	pv[1] = "C3"
	if out.Candidates[0].PV[1] != "Q16" {
		t.Fatalf("candidate pv = %#v", out.Candidates[0].PV)
	}
}

func TestNormalizeAnalysisKeepsRawCandidatesAndOwnership(t *testing.T) {
	result := katago.Result{
		RootInfo:  katago.RootInfo{Visits: 100, Winrate: 0.52, ScoreLead: 1.5},
		Ownership: []float64{-1, 0, 1},
		Policy:    []float64{0.1, 0.2, 0.7},
		MoveInfos: []katago.MoveInfo{
			{Move: "Q16", Order: 0, Visits: 90, Winrate: 0.53, ScoreLead: 1.8, PV: []string{"Q16", "D4"}},
		},
	}
	out := NormalizeAnalysis(Black, result)
	if out.Root.Winrate != 0.52 || out.Root.ScoreLead != 1.5 || out.Root.Visits != 100 {
		t.Fatalf("root = %#v", out.Root)
	}
	if len(out.Candidates) != 1 || out.Candidates[0].Move != "Q16" || out.Candidates[0].PV[1] != "D4" {
		t.Fatalf("candidates = %#v", out.Candidates)
	}
	if len(out.OwnershipQ8) != 3 {
		t.Fatalf("ownership q8 length = %d", len(out.OwnershipQ8))
	}
	if len(out.Policy) != 3 || out.Policy[2] != 0.7 {
		t.Fatalf("policy = %#v", out.Policy)
	}
}

func TestMistakeThresholdsMatchKaTrain(t *testing.T) {
	if MistakeClass(12.0) != 0 || MistakeClass(6.0) != 1 || MistakeClass(3.0) != 2 || MistakeClass(1.5) != 3 {
		t.Fatal("threshold classes do not match KaTrain default order")
	}
	if !IsBadMove(3.1) || IsBadMove(3.0) {
		t.Fatal("mistake threshold should be greater than KaTrain eval_thresholds[-4]")
	}
}

func TestEncodeOwnershipQ8(t *testing.T) {
	encoded := EncodeOwnershipQ8([]float64{-1, -0.5, 0, 0.5, 1})
	want := []byte{129, 193, 0, 63, 127}
	if !bytes.Equal(encoded, want) {
		t.Fatalf("encoded = %v, want %v", encoded, want)
	}
	decoded := DecodeOwnershipQ8(encoded)
	if len(decoded) != 5 {
		t.Fatalf("decoded length = %d", len(decoded))
	}
	if decoded[0] != -1 || decoded[2] != 0 || decoded[4] != 1 {
		t.Fatalf("decoded edge values = %v", decoded)
	}
}

func TestCurrentAnalysisInputIncludesVariationPath(t *testing.T) {
	doc, err := ParseSGF(`(;GM[1]FF[4]SZ[19]KM[7.5]RU[chinese];B[pd];W[dd])`)
	if err != nil {
		t.Fatal(err)
	}
	g, err := NewFromSGF("game-1", doc)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := g.GotoMain(1); err != nil {
		t.Fatal(err)
	}
	if _, err := g.PlayVariation(White, "Q4"); err != nil {
		t.Fatal(err)
	}

	input, ok := g.CurrentAnalysisInput()
	if !ok {
		t.Fatal("expected current analysis input")
	}
	if input.NodeID != "var:1" || input.MoveNumber != 2 || input.MoveColor != White || input.Move != "Q4" || input.ToPlay != Black {
		t.Fatalf("input = %#v", input)
	}
	if len(input.Moves) != 2 || input.Moves[0].Player != "B" || input.Moves[0].Move != "Q16" || input.Moves[1].Player != "W" || input.Moves[1].Move != "Q4" {
		t.Fatalf("moves = %#v", input.Moves)
	}
}

func TestAnalysisInputsUseRootToPlayAsInitialPlayer(t *testing.T) {
	doc, err := ParseSGF(`(;GM[1]FF[4]SZ[19]HA[2]AB[dd][pp];W[pd])`)
	if err != nil {
		t.Fatal(err)
	}
	g, err := NewFromSGF("game-1", doc)
	if err != nil {
		t.Fatal(err)
	}

	inputs := g.MainlineAnalysisInputs()
	if len(inputs) != 2 {
		t.Fatalf("inputs = %#v", inputs)
	}
	if inputs[0].InitialPlayer != White || inputs[1].InitialPlayer != White {
		t.Fatalf("initial players = %s, %s", inputs[0].InitialPlayer, inputs[1].InitialPlayer)
	}
}
