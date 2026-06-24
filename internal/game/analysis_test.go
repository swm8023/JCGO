package game

import (
	"testing"

	"jcgo/internal/katago"
)

func TestNormalizeAnalysisCandidatePointLossForBlackToPlay(t *testing.T) {
	out := NormalizeAnalysis(Black, katago.Result{
		RootInfo: katago.RootInfo{Winrate: 0.55, ScoreLead: 3.0, Visits: 500},
		MoveInfos: []katago.MoveInfo{
			{Move: "Q16", Order: 0, Visits: 400, Winrate: 0.56, ScoreLead: 3.4, PV: []string{"Q16", "D16"}},
			{Move: "D4", Order: 1, Visits: 80, Winrate: 0.50, ScoreLead: 1.0, PV: []string{"D4"}},
		},
	})
	if out.Candidates[1].PointLoss != 2.0 {
		t.Fatalf("PointLoss = %.1f", out.Candidates[1].PointLoss)
	}
	if out.Candidates[1].RelativePointLoss != 2.4 {
		t.Fatalf("RelativePointLoss = %.1f", out.Candidates[1].RelativePointLoss)
	}
	if out.Candidates[1].LowVisits {
		t.Fatal("LowVisits = true for 80 visits")
	}
}

func TestNormalizeAnalysisCandidatePointLossForWhiteToPlay(t *testing.T) {
	out := NormalizeAnalysis(White, katago.Result{
		RootInfo: katago.RootInfo{Winrate: 0.45, ScoreLead: -2.0, Visits: 500},
		MoveInfos: []katago.MoveInfo{
			{Move: "D4", Order: 0, Visits: 400, Winrate: 0.44, ScoreLead: -2.5},
			{Move: "Q16", Order: 1, Visits: 20, Winrate: 0.50, ScoreLead: 1.0},
		},
	})
	if out.Candidates[1].PointLoss != 3.0 {
		t.Fatalf("PointLoss = %.1f", out.Candidates[1].PointLoss)
	}
	if !out.Candidates[1].LowVisits {
		t.Fatal("LowVisits = false for secondary 20-visit move")
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
