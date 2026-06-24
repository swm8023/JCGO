package app

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"jcgo/internal/store"
)

func TestImportListRenameDeleteGame(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	repo, err := store.Open(ctx, filepath.Join(dir, "jcgo.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	handler := NewHandler(repo, store.NewFileStore(filepath.Join(dir, "games")), NewWorkspaceStore(), nil)

	result, err := handler.Call(ctx, "secret", "game.importSgf", json.RawMessage(`{"displayName":"Demo","originalFilename":"demo.sgf","sgfText":"(;GM[1]FF[4]SZ[19]RE[B+R];B[pd])"}`))
	if err != nil {
		t.Fatal(err)
	}
	imported := result.(ImportResult)
	if imported.Game.DisplayName != "Demo" || imported.Game.Result != "B+R" || imported.Snapshot.MoveNumber != 0 {
		t.Fatalf("imported = %#v", imported)
	}
	if imported.Game.SGFFilename != imported.Game.ID+".sgf" {
		t.Fatalf("sgf filename = %q, id = %q", imported.Game.SGFFilename, imported.Game.ID)
	}
	if _, err := os.Stat(filepath.Join(dir, "games", imported.Game.SGFFilename)); err != nil {
		t.Fatal(err)
	}

	if _, err := handler.Call(ctx, "secret", "game.rename", json.RawMessage(`{"gameId":"`+imported.Game.ID+`","displayName":"Renamed"}`)); err != nil {
		t.Fatal(err)
	}
	listResult, err := handler.Call(ctx, "secret", "game.list", nil)
	if err != nil {
		t.Fatal(err)
	}
	if listResult.(ListResult).Games[0].DisplayName != "Renamed" {
		t.Fatalf("list = %#v", listResult)
	}

	if _, err := handler.Call(ctx, "secret", "game.delete", json.RawMessage(`{"gameId":"`+imported.Game.ID+`"}`)); err != nil {
		t.Fatal(err)
	}
	listResult, err = handler.Call(ctx, "secret", "game.list", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(listResult.(ListResult).Games) != 0 {
		t.Fatalf("list after delete = %#v", listResult)
	}
	if _, err := os.Stat(filepath.Join(dir, "games", imported.Game.SGFFilename)); !os.IsNotExist(err) {
		t.Fatalf("expected sgf deletion, stat err = %v", err)
	}
}

func TestImportRejectsEmptyDisplayName(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	repo, err := store.Open(ctx, filepath.Join(dir, "jcgo.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	handler := NewHandler(repo, store.NewFileStore(filepath.Join(dir, "games")), NewWorkspaceStore(), nil)

	_, err = handler.Call(ctx, "secret", "game.importSgf", json.RawMessage(`{"displayName":" ","originalFilename":"demo.sgf","sgfText":"(;GM[1]FF[4]SZ[19];B[pd])"}`))
	if err == nil {
		t.Fatal("expected empty display name rejection")
	}
}

func TestAnalysisStartStoresResultInWorkspace(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	repo, err := store.Open(ctx, filepath.Join(dir, "jcgo.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	workspaces := NewWorkspaceStore()
	scheduler := NewScheduler(&fakeAnalyzer{}, 500)
	defer scheduler.Close()
	handler := NewHandler(repo, store.NewFileStore(filepath.Join(dir, "games")), workspaces, scheduler)

	result, err := handler.Call(ctx, "secret", "game.importSgf", json.RawMessage(`{"displayName":"Demo","sgfText":"(;GM[1]FF[4]SZ[19];B[pd])"}`))
	if err != nil {
		t.Fatal(err)
	}
	gameID := result.(ImportResult).Game.ID
	if _, err := handler.Call(ctx, "secret", "analysis.start", json.RawMessage(`{"gameId":"`+gameID+`"}`)); err != nil {
		t.Fatal(err)
	}

	deadline := time.After(time.Second)
	for {
		snap, err := workspaces.ForToken("secret").CurrentSnapshot(gameID)
		if err != nil {
			t.Fatal(err)
		}
		if snap.Analysis != nil && len(snap.Analysis.Candidates) == 1 {
			return
		}
		select {
		case <-deadline:
			t.Fatalf("analysis not stored in snapshot: %#v", snap)
		default:
			time.Sleep(10 * time.Millisecond)
		}
	}
}
