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
