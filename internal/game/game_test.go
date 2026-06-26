package game

import "testing"

func TestLoadMainlineAndSnapshots(t *testing.T) {
	doc, err := ParseSGF(`(;GM[1]FF[4]SZ[19]KM[7.5]RU[chinese];B[pd];W[dd];B[qp])`)
	if err != nil {
		t.Fatal(err)
	}
	g, err := NewFromSGF("game-1", doc)
	if err != nil {
		t.Fatal(err)
	}
	snap, err := g.GotoMain(2)
	if err != nil {
		t.Fatal(err)
	}
	if snap.MoveNumber != 2 || snap.TotalMoves != 3 || snap.LastMove == nil || snap.LastMove.GTP != "D16" {
		t.Fatalf("snapshot = %#v", snap)
	}
	if len(snap.Stones) != 2 {
		t.Fatalf("stones = %#v", snap.Stones)
	}
	if snap.ToPlay != Black || !snap.CanPrevious || !snap.CanNext || snap.CanBackToMain {
		t.Fatalf("navigation snapshot = %#v", snap)
	}
	if len(snap.Children) != 1 || snap.Children[0].GTP != "R4" || snap.Children[0].Color != Black {
		t.Fatalf("children = %#v", snap.Children)
	}
}

func TestSnapshotIncludesGameInfo(t *testing.T) {
	doc, err := ParseSGF(`(;GM[1]FF[4]SZ[19]KM[7.5]RU[chinese]PB[Black A]PW[White B]RE[B+R];B[pd])`)
	if err != nil {
		t.Fatal(err)
	}
	g, err := NewFromSGF("game-1", doc)
	if err != nil {
		t.Fatal(err)
	}
	snap := g.CurrentSnapshot()
	if snap.BlackName != "Black A" || snap.WhiteName != "White B" {
		t.Fatalf("snapshot players = %q/%q", snap.BlackName, snap.WhiteName)
	}
	if snap.Result != "B+R" || snap.Komi != 7.5 || snap.Rules != "chinese" {
		t.Fatalf("snapshot metadata = %#v", snap)
	}
}

func TestSnapshotIncludesMainlineAndVariationChildren(t *testing.T) {
	doc, err := ParseSGF(`(;GM[1]FF[4]SZ[19];B[pd];W[dd];B[qp])`)
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
	snap, err := g.BackToMain()
	if err != nil {
		t.Fatal(err)
	}

	if len(snap.Children) != 2 {
		t.Fatalf("children = %#v", snap.Children)
	}
	if snap.Children[0].NodeID != "main:2" || snap.Children[0].MoveNumber != 2 || snap.Children[0].Color != White || snap.Children[0].GTP != "D16" {
		t.Fatalf("main child = %#v", snap.Children[0])
	}
	if snap.Children[1].MoveNumber != 2 || snap.Children[1].Color != White || snap.Children[1].GTP != "Q4" {
		t.Fatalf("variation child = %#v", snap.Children[1])
	}
}

func TestRootSetupAndHandicapToPlay(t *testing.T) {
	doc, err := ParseSGF(`(;GM[1]FF[4]SZ[19]HA[2]AB[dd][pp];W[pd])`)
	if err != nil {
		t.Fatal(err)
	}
	g, err := NewFromSGF("game-1", doc)
	if err != nil {
		t.Fatal(err)
	}
	snap := g.CurrentSnapshot()
	if len(snap.Stones) != 2 || snap.ToPlay != White {
		t.Fatalf("snapshot = %#v", snap)
	}
}

func TestCaptureAndPassEndState(t *testing.T) {
	g := NewEmpty("game-1", "chinese", 7.5)
	mustPlay(t, g, Black, "B2")
	mustPlay(t, g, White, "A2")
	mustPlay(t, g, Black, "A1")
	mustPlay(t, g, White, "pass")
	mustPlay(t, g, Black, "A3")

	snap := g.CurrentSnapshot()
	if snap.Captures[Black] != 1 || hasStone(snap.Stones, 0, 17, White) {
		t.Fatalf("capture snapshot = %#v", snap)
	}

	mustPlay(t, g, White, "pass")
	mustPlay(t, g, Black, "pass")
	snap = g.CurrentSnapshot()
	if !snap.GameEnded {
		t.Fatalf("GameEnded = false")
	}
}

func TestRejectsOccupiedPointAndSuicide(t *testing.T) {
	g := NewEmpty("game-1", "chinese", 7.5)
	mustPlay(t, g, Black, "A2")
	if _, err := g.PlayVariation(White, "A2"); err == nil {
		t.Fatal("expected occupied point rejection")
	}

	g = NewEmpty("game-2", "chinese", 7.5)
	mustPlay(t, g, Black, "B1")
	mustPlay(t, g, White, "pass")
	mustPlay(t, g, Black, "A2")
	if _, err := g.PlayVariation(White, "A1"); err == nil {
		t.Fatal("expected suicide rejection")
	}
}

func TestRejectsImmediateKoRecapture(t *testing.T) {
	g := NewEmpty("game-1", "chinese", 7.5)
	mustPlay(t, g, Black, "B2")
	mustPlay(t, g, White, "A2")
	mustPlay(t, g, Black, "A3")
	mustPlay(t, g, White, "B1")
	mustPlay(t, g, Black, "A1")

	if _, err := g.PlayVariation(White, "A2"); err == nil {
		t.Fatal("expected ko recapture rejection")
	}
}

func TestPlayVariationFromMainNodeAndBackToMain(t *testing.T) {
	doc, err := ParseSGF(`(;GM[1]FF[4]SZ[19];B[pd];W[dd])`)
	if err != nil {
		t.Fatal(err)
	}
	g, err := NewFromSGF("game-1", doc)
	if err != nil {
		t.Fatal(err)
	}
	snap, err := g.PlayVariation(Black, "D4")
	if err != nil {
		t.Fatal(err)
	}
	if snap.BranchMode != "variation" || !snap.CanBackToMain || snap.MoveNumber != 1 {
		t.Fatalf("variation snapshot = %#v", snap)
	}

	snap, err = g.BackToMain()
	if err != nil {
		t.Fatal(err)
	}
	if snap.BranchMode != "main" || snap.MoveNumber != 0 || snap.CanBackToMain {
		t.Fatalf("main snapshot = %#v", snap)
	}
}

func TestGotoVariationNode(t *testing.T) {
	doc, err := ParseSGF(`(;GM[1]FF[4]SZ[19];B[pd];W[dd])`)
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
	if _, err := g.PlayVariation(Black, "D4"); err != nil {
		t.Fatal(err)
	}
	if _, err := g.BackToMain(); err != nil {
		t.Fatal(err)
	}

	snap, err := g.GotoNode("var:2")
	if err != nil {
		t.Fatal(err)
	}
	if snap.NodeID != "var:2" || snap.BranchMode != "variation" || snap.MoveNumber != 3 || snap.LastMove == nil || snap.LastMove.GTP != "D4" {
		t.Fatalf("variation snapshot = %#v", snap)
	}
}

func TestDeleteAndClearVariation(t *testing.T) {
	g := NewEmpty("game-1", "chinese", 7.5)
	if _, err := g.PlayVariation(Black, "D4"); err != nil {
		t.Fatal(err)
	}
	if _, err := g.PlayVariation(White, "Q16"); err != nil {
		t.Fatal(err)
	}
	snap, err := g.DeleteCurrentVariationNode()
	if err != nil {
		t.Fatal(err)
	}
	if snap.BranchMode != "variation" || snap.MoveNumber != 1 {
		t.Fatalf("delete snapshot = %#v", snap)
	}
	snap, err = g.ClearCurrentVariation()
	if err != nil {
		t.Fatal(err)
	}
	if snap.BranchMode != "main" || snap.MoveNumber != 0 || snap.CanBackToMain {
		t.Fatalf("clear snapshot = %#v", snap)
	}
}

func mustPlay(t *testing.T, g *Game, color Color, gtp string) {
	t.Helper()
	if _, err := g.PlayVariation(color, gtp); err != nil {
		t.Fatalf("play %s %s: %v", color, gtp, err)
	}
}

func hasStone(stones []Stone, x, y int, color Color) bool {
	for _, stone := range stones {
		if stone.X == x && stone.Y == y && stone.Color == color {
			return true
		}
	}
	return false
}
