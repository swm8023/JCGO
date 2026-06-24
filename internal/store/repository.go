package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

type GameRecord struct {
	ID          string    `json:"gameId"`
	DisplayName string    `json:"displayName"`
	Result      string    `json:"result"`
	SGFFilename string    `json:"sgfFilename"`
	CreatedAt   time.Time `json:"createdAt"`
}

type CreateGameInput struct {
	DisplayName string
	Result      string
	SGFFilename string
}

type Repository struct {
	db *sql.DB
}

func Open(ctx context.Context, dbPath string) (*Repository, error) {
	db, err := sql.Open("sqlite", filepath.ToSlash(dbPath))
	if err != nil {
		return nil, err
	}
	repo := &Repository{db: db}
	if err := repo.migrate(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return repo, nil
}

func (r *Repository) Close() error {
	return r.db.Close()
}

func (r *Repository) CreateGame(ctx context.Context, input CreateGameInput) (GameRecord, error) {
	if input.DisplayName == "" {
		return GameRecord{}, errors.New("display name is required")
	}
	if input.SGFFilename == "" {
		return GameRecord{}, errors.New("sgf filename is required")
	}
	id, err := newID()
	if err != nil {
		return GameRecord{}, err
	}
	game := GameRecord{
		ID:          id,
		DisplayName: input.DisplayName,
		Result:      input.Result,
		SGFFilename: filepath.Base(input.SGFFilename),
		CreatedAt:   time.Now().UTC(),
	}
	_, err = r.db.ExecContext(ctx, `
		INSERT INTO games (id, display_name, result, sgf_filename, created_at)
		VALUES (?, ?, ?, ?, ?)
	`, game.ID, game.DisplayName, game.Result, game.SGFFilename, formatTime(game.CreatedAt))
	if err != nil {
		return GameRecord{}, err
	}
	return game, nil
}

func (r *Repository) ListGames(ctx context.Context) ([]GameRecord, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, display_name, result, sgf_filename, created_at
		FROM games
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var games []GameRecord
	for rows.Next() {
		game, err := scanGame(rows)
		if err != nil {
			return nil, err
		}
		games = append(games, game)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return games, nil
}

func (r *Repository) GetGame(ctx context.Context, id string) (GameRecord, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT id, display_name, result, sgf_filename, created_at
		FROM games
		WHERE id = ?
	`, id)
	return scanGame(row)
}

func (r *Repository) RenameGame(ctx context.Context, id, displayName string) error {
	if displayName == "" {
		return errors.New("display name is required")
	}
	result, err := r.db.ExecContext(ctx, `
		UPDATE games
		SET display_name = ?
		WHERE id = ?
	`, displayName, id)
	if err != nil {
		return err
	}
	return requireAffected(result)
}

func (r *Repository) DeleteGame(ctx context.Context, id string) error {
	result, err := r.db.ExecContext(ctx, `DELETE FROM games WHERE id = ?`, id)
	if err != nil {
		return err
	}
	return requireAffected(result)
}

func (r *Repository) migrate(ctx context.Context) error {
	_, err := r.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS games (
			id TEXT PRIMARY KEY,
			display_name TEXT NOT NULL,
			result TEXT NOT NULL,
			sgf_filename TEXT NOT NULL,
			created_at TEXT NOT NULL
		)
	`)
	return err
}

type gameScanner interface {
	Scan(dest ...any) error
}

func scanGame(scanner gameScanner) (GameRecord, error) {
	var game GameRecord
	var createdAt string
	if err := scanner.Scan(&game.ID, &game.DisplayName, &game.Result, &game.SGFFilename, &createdAt); err != nil {
		return GameRecord{}, err
	}
	parsed, err := time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		return GameRecord{}, err
	}
	game.CreatedAt = parsed
	return game, nil
}

func requireAffected(result sql.Result) error {
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func formatTime(t time.Time) string {
	return t.UTC().Format(time.RFC3339Nano)
}

func newID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes[:]), nil
}
