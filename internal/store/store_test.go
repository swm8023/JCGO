package store

import (
	"context"
	"database/sql"
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
		GameDate:    "2026-06-23",
	})
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(time.Millisecond)
	newGame, err := repo.CreateGame(ctx, CreateGameInput{
		DisplayName: "New",
		Result:      "W+R",
		SGFFilename: "new.sgf",
		GameDate:    "2026-06-24",
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
	if games[0].GameDate != "2026-06-24" || games[1].GameDate != "2026-06-23" {
		t.Fatalf("game dates = %#v", games)
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

func TestRepositoryMigratesExistingGamesTableWithGameDate(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "jcgo.sqlite")
	db, err := sql.Open("sqlite", filepath.ToSlash(dbPath))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
		CREATE TABLE games (
			id TEXT PRIMARY KEY,
			display_name TEXT NOT NULL,
			result TEXT NOT NULL,
			sgf_filename TEXT NOT NULL,
			created_at TEXT NOT NULL
		)
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO games (id, display_name, result, sgf_filename, created_at)
		VALUES ('old', 'Old', 'B+R', 'old.sgf', '2026-06-24T01:00:00Z')
	`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	repo, err := Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()

	games, err := repo.ListGames(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(games) != 1 || games[0].GameDate != "" {
		t.Fatalf("migrated games = %#v", games)
	}
	newGame, err := repo.CreateGame(ctx, CreateGameInput{
		DisplayName: "New",
		Result:      "W+R",
		GameDate:    "2026-06-25",
		SGFFilename: "new.sgf",
	})
	if err != nil {
		t.Fatal(err)
	}
	if newGame.GameDate != "2026-06-25" {
		t.Fatalf("new game date = %q", newGame.GameDate)
	}
}

func TestRepositoryStoresAndFindsGameSource(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	repo, err := Open(ctx, filepath.Join(dir, "jcgo.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()

	game, err := repo.CreateGame(ctx, CreateGameInput{
		DisplayName:    "YuanluoBo",
		Result:         "B+R",
		GameDate:       "2026-07-08",
		SGFFilename:    "ylb.sgf",
		SourcePlatform: "yuanluobo",
		SourceID:       "session-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if game.SourcePlatform != "yuanluobo" || game.SourceID != "session-1" {
		t.Fatalf("created source = %q/%q", game.SourcePlatform, game.SourceID)
	}

	found, ok, err := repo.FindGameBySource(ctx, "yuanluobo", "session-1")
	if err != nil {
		t.Fatal(err)
	}
	if !ok || found.ID != game.ID {
		t.Fatalf("found = %#v, ok = %v", found, ok)
	}

	listed, err := repo.ListGames(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].SourceID != "session-1" {
		t.Fatalf("listed = %#v", listed)
	}
}

func TestRepositoryStoresWorkerConfigsWithDefaults(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	repo, err := Open(ctx, filepath.Join(dir, "jcgo.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()

	cfg, err := repo.GetOrCreateWorkerConfig(ctx, "local-gpu")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Name != "local-gpu" || cfg.Model != DefaultWorkerModel || cfg.MaxVisits != DefaultWorkerMaxVisits {
		t.Fatalf("default worker config = %#v", cfg)
	}

	updated, err := repo.UpsertWorkerConfig(ctx, WorkerConfigInput{
		Name:      "local-gpu",
		Model:     "kata1-b28c512nbt-s13255194368-d5935380940.bin.gz",
		MaxVisits: 900,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Model != "kata1-b28c512nbt-s13255194368-d5935380940.bin.gz" || updated.MaxVisits != 900 {
		t.Fatalf("updated worker config = %#v", updated)
	}

	configs, err := repo.ListWorkerConfigs(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(configs) != 1 || configs[0].Name != "local-gpu" || configs[0].MaxVisits != 900 {
		t.Fatalf("worker configs = %#v", configs)
	}
}

func TestRepositoryStoresGameAnalysisWorkerName(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	repo, err := Open(ctx, filepath.Join(dir, "jcgo.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()

	game, err := repo.CreateGame(ctx, CreateGameInput{DisplayName: "Demo", Result: "B+R"})
	if err != nil {
		t.Fatal(err)
	}
	if game.AnalysisWorkerName != "" {
		t.Fatalf("new game analysis worker = %q", game.AnalysisWorkerName)
	}

	if err := repo.UpdateGameAnalysisWorker(ctx, game.ID, "local-gpu"); err != nil {
		t.Fatal(err)
	}
	stored, err := repo.GetGame(ctx, game.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.AnalysisWorkerName != "local-gpu" {
		t.Fatalf("stored worker = %q", stored.AnalysisWorkerName)
	}
	listed, err := repo.ListGames(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].AnalysisWorkerName != "local-gpu" {
		t.Fatalf("listed games = %#v", listed)
	}
}

func TestRepositoryMigratesExistingGamesTableWithSourceColumns(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "jcgo.sqlite")
	db, err := sql.Open("sqlite", filepath.ToSlash(dbPath))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
		CREATE TABLE games (
			id TEXT PRIMARY KEY,
			display_name TEXT NOT NULL,
			result TEXT NOT NULL,
			game_date TEXT NOT NULL DEFAULT '',
			sgf_filename TEXT NOT NULL,
			created_at TEXT NOT NULL
		)
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO games (id, display_name, result, game_date, sgf_filename, created_at)
		VALUES ('old', 'Old', 'B+R', '2026-07-08', 'old.sgf', '2026-07-08T01:00:00Z')
	`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	repo, err := Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()

	old, err := repo.GetGame(ctx, "old")
	if err != nil {
		t.Fatal(err)
	}
	if old.SourcePlatform != "" || old.SourceID != "" {
		t.Fatalf("legacy source = %q/%q", old.SourcePlatform, old.SourceID)
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

func TestFileStoreWritesReadsAndDeletesAnalysisNextToSGF(t *testing.T) {
	dir := t.TempDir()
	files := NewFileStore(dir)

	path, err := files.WriteAnalysis("game-1.sgf", []byte(`{"schema":1}`))
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(path) != "game-1.analysis.json" {
		t.Fatalf("path = %s", path)
	}
	data, err := files.ReadAnalysis("game-1.sgf")
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != `{"schema":1}` {
		t.Fatalf("analysis = %s", data)
	}
	if err := files.DeleteAnalysis("game-1.sgf"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("expected deleted analysis file, stat err = %v", err)
	}
}
