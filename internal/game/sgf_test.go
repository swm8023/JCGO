package game

import "testing"

func TestParseSGFMainlineSimple19(t *testing.T) {
	doc, err := ParseSGF(`(;GM[1]FF[4]SZ[19]KM[7.5]RU[chinese]PB[Black]PW[White]RE[B+R];B[pd];W[dd](;B[qq])(;B[pp]))`)
	if err != nil {
		t.Fatal(err)
	}
	if doc.BoardSize != 19 || doc.Komi != 7.5 || doc.Rules != "chinese" || doc.Result != "B+R" {
		t.Fatalf("doc = %#v", doc)
	}
	if len(doc.Mainline) != 2 {
		t.Fatalf("mainline length = %d", len(doc.Mainline))
	}
	if doc.Mainline[0].GTP != "Q16" || doc.Mainline[1].GTP != "D16" {
		t.Fatalf("mainline = %#v", doc.Mainline)
	}
}

func TestParseSGFDefaultsRulesAndKomi(t *testing.T) {
	doc, err := ParseSGF(`(;GM[1]FF[4]SZ[19];B[pd])`)
	if err != nil {
		t.Fatal(err)
	}
	if doc.Rules != "chinese" || doc.Komi != 7.5 {
		t.Fatalf("defaults = %s %.1f", doc.Rules, doc.Komi)
	}
}

func TestParseSGFReadsPlayerNamesResultRulesAndKomi(t *testing.T) {
	doc, err := ParseSGF(`(;GM[1]FF[4]SZ[19]KM[6.5]RU[japanese]PB[Lee]PW[Cho]RE[W+1.5]DT[2026-06-24];B[pd];W[dd])`)
	if err != nil {
		t.Fatal(err)
	}
	if doc.BlackName != "Lee" || doc.WhiteName != "Cho" {
		t.Fatalf("players = %q/%q", doc.BlackName, doc.WhiteName)
	}
	if doc.Result != "W+1.5" || doc.Rules != "japanese" || doc.Komi != 6.5 {
		t.Fatalf("metadata = result %q rules %q komi %.1f", doc.Result, doc.Rules, doc.Komi)
	}
	if doc.GameDate != "2026-06-24" {
		t.Fatalf("game date = %q", doc.GameDate)
	}
}

func TestParseSGFRejectsNonRootSetup(t *testing.T) {
	_, err := ParseSGF(`(;GM[1]FF[4]SZ[19];B[pd]AB[dd])`)
	if err == nil {
		t.Fatal("expected non-root setup rejection")
	}
}

func TestParseSGFRejectsNon19Board(t *testing.T) {
	_, err := ParseSGF(`(;GM[1]FF[4]SZ[13];B[dd])`)
	if err == nil {
		t.Fatal("expected non-19 board rejection")
	}
}

func TestParseSGFRejectsInvalidCoordinate(t *testing.T) {
	_, err := ParseSGF(`(;GM[1]FF[4]SZ[19];B[DD])`)
	if err == nil {
		t.Fatal("expected invalid coordinate rejection")
	}
}

func TestParseSGFRootSetup(t *testing.T) {
	doc, err := ParseSGF(`(;GM[1]FF[4]SZ[19]HA[2]AB[dd][pp];W[pd])`)
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.InitialStones) != 2 || doc.Mainline[0].GTP != "Q16" {
		t.Fatalf("doc = %#v", doc)
	}
}

func TestParseSGFPassMoves(t *testing.T) {
	doc, err := ParseSGF(`(;GM[1]FF[4]SZ[19];B[];W[tt])`)
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Mainline) != 2 || !doc.Mainline[0].Pass || !doc.Mainline[1].Pass {
		t.Fatalf("mainline = %#v", doc.Mainline)
	}
}
