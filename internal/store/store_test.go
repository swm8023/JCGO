package store

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestRepositoryCreatesListsRenamesAndDeletesGames(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	repo, err := Open(ctx, filepath.Join(dir, "jcgo.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()

	oldGame, err := repo.CreateGame(ctx, CreateGameInput{
		DisplayName: "Old",
		Result:      "B+R",
		SGFFilename: "old.sgf",
	})
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(time.Millisecond)
	newGame, err := repo.CreateGame(ctx, CreateGameInput{
		DisplayName: "New",
		Result:      "W+R",
		SGFFilename: "new.sgf",
	})
	if err != nil {
		t.Fatal(err)
	}

	games, err := repo.ListGames(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(games) != 2 || games[0].ID != newGame.ID || games[1].ID != oldGame.ID {
		t.Fatalf("games not sorted newest first: %#v", games)
	}

	if err := repo.RenameGame(ctx, oldGame.ID, "Renamed"); err != nil {
		t.Fatal(err)
	}
	renamed, err := repo.GetGame(ctx, oldGame.ID)
	if err != nil {
		t.Fatal(err)
	}
	if renamed.DisplayName != "Renamed" {
		t.Fatalf("DisplayName = %q", renamed.DisplayName)
	}

	if err := repo.DeleteGame(ctx, oldGame.ID); err != nil {
		t.Fatal(err)
	}
	games, err = repo.ListGames(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(games) != 1 || games[0].ID != newGame.ID {
		t.Fatalf("games after delete = %#v", games)
	}
}

func TestFileStoreWritesReadsAndDeletesSGF(t *testing.T) {
	dir := t.TempDir()
	files := NewFileStore(dir)
	path, err := files.WriteSGF("game-1", "(;SZ[19])")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(path) != "game-1.sgf" {
		t.Fatalf("path = %s", path)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}
	text, err := files.ReadSGF("game-1.sgf")
	if err != nil {
		t.Fatal(err)
	}
	if text != "(;SZ[19])" {
		t.Fatalf("text = %q", text)
	}
	if err := files.DeleteSGF("game-1.sgf"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("expected deleted file, stat err = %v", err)
	}
}
