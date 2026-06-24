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
