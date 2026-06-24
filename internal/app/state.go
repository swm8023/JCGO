package app

import (
	"context"

	"jcgo/internal/game"
	"jcgo/internal/store"
)

type AnalysisState string

const (
	AnalysisIdle     AnalysisState = "idle"
	AnalysisRunning  AnalysisState = "running"
	AnalysisStopped  AnalysisState = "stopped"
	AnalysisComplete AnalysisState = "complete"
)

type WorkspaceState struct {
	Games          []store.GameRecord `json:"games"`
	SelectedGameID string             `json:"selectedGameId,omitempty"`
	Snapshot       *game.Snapshot     `json:"snapshot,omitempty"`
	ChartPoints    []game.ChartPoint  `json:"chartPoints"`
	BadMoves       []game.BadMove     `json:"badMoves"`
	AnalysisState  AnalysisState      `json:"analysisState"`
}

func (h *Handler) workspaceState(ctx context.Context, token string) (WorkspaceState, error) {
	games, err := h.repo.ListGames(ctx)
	if err != nil {
		return WorkspaceState{}, err
	}
	state := WorkspaceState{
		Games:         games,
		ChartPoints:   []game.ChartPoint{},
		BadMoves:      []game.BadMove{},
		AnalysisState: AnalysisIdle,
	}
	ws := h.workspaces.ForToken(token)
	selectedGameID := ws.SelectedGameID()
	if selectedGameID == "" {
		return state, nil
	}
	if _, err := h.ensureWorkspaceGame(ctx, token, selectedGameID); err != nil {
		return WorkspaceState{}, err
	}
	snapshot, err := ws.SelectedSnapshot()
	if err != nil {
		return WorkspaceState{}, err
	}
	points, badMoves, analysisState, err := ws.AnalysisView(selectedGameID)
	if err != nil {
		return WorkspaceState{}, err
	}
	state.SelectedGameID = selectedGameID
	state.Snapshot = snapshot
	state.ChartPoints = points
	state.BadMoves = badMoves
	state.AnalysisState = analysisState
	return state, nil
}
