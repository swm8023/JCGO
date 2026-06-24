package app

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sync"

	"jcgo/internal/game"
)

type WorkspaceStore struct {
	mu         sync.Mutex
	workspaces map[string]*Workspace
}

type Workspace struct {
	mu             sync.Mutex
	games          map[string]*game.Game
	selectedGameID string
}

func NewWorkspaceStore() *WorkspaceStore {
	return &WorkspaceStore{workspaces: map[string]*Workspace{}}
}

func (s *WorkspaceStore) ForToken(token string) *Workspace {
	sum := sha256.Sum256([]byte(token))
	key := hex.EncodeToString(sum[:])

	s.mu.Lock()
	defer s.mu.Unlock()
	if ws := s.workspaces[key]; ws != nil {
		return ws
	}
	ws := &Workspace{games: map[string]*game.Game{}}
	s.workspaces[key] = ws
	return ws
}

func (w *Workspace) LoadGame(gameID string, doc game.SGFDocument) error {
	g, err := game.NewFromSGF(gameID, doc)
	if err != nil {
		return err
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	w.games[gameID] = g
	w.selectedGameID = gameID
	return nil
}

func (w *Workspace) CurrentSnapshot(gameID string) (game.Snapshot, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	g, err := w.game(gameID)
	if err != nil {
		return game.Snapshot{}, err
	}
	return g.CurrentSnapshot(), nil
}

func (w *Workspace) Play(gameID string, gtp string) (game.Snapshot, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	g, err := w.game(gameID)
	if err != nil {
		return game.Snapshot{}, err
	}
	color := g.CurrentSnapshot().ToPlay
	return g.PlayVariation(color, gtp)
}

func (w *Workspace) BackToMain(gameID string) (game.Snapshot, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	g, err := w.game(gameID)
	if err != nil {
		return game.Snapshot{}, err
	}
	return g.BackToMain()
}

func (w *Workspace) game(gameID string) (*game.Game, error) {
	g := w.games[gameID]
	if g == nil {
		return nil, fmt.Errorf("game %s not loaded", gameID)
	}
	return g, nil
}
