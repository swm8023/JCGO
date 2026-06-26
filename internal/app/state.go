package app

import (
	"context"

	"jcgo/internal/store"
)

type AnalysisState string

const (
	AnalysisIdle     AnalysisState = "idle"
	AnalysisRunning  AnalysisState = "running"
	AnalysisStopped  AnalysisState = "stopped"
	AnalysisComplete AnalysisState = "complete"
)

type EmptyWorkspaceState struct {
	Type          string             `json:"type"`
	Schema        int                `json:"schema"`
	Games         []store.GameRecord `json:"games"`
	AnalysisState AnalysisState      `json:"analysisState"`
}

func (h *Handler) workspaceState(ctx context.Context, token string) (any, error) {
	games, err := h.repo.ListGames(ctx)
	if err != nil {
		return nil, err
	}
	ws := h.workspaces.ForToken(token)
	selectedGameID := ws.SelectedGameID()
	if selectedGameID == "" {
		return EmptyWorkspaceState{Type: "state", Schema: 1, Games: games, AnalysisState: AnalysisIdle}, nil
	}
	if _, err := h.ensureWorkspaceGame(ctx, token, selectedGameID); err != nil {
		return nil, err
	}
	payload, err := ws.StatePayload(selectedGameID)
	if err != nil {
		return nil, err
	}
	payload.Games = games
	return payload, nil
}
