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

type EmptyWorkspaceState struct {
	Type          string             `json:"type"`
	Schema        int                `json:"schema"`
	Games         []store.GameRecord `json:"games"`
	AnalysisState AnalysisState      `json:"analysisState"`
}

func (h *Handler) workspaceState(ctx context.Context, token string) (any, error) {
	games, err := h.listGames(ctx, token)
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

func (h *Handler) listGames(ctx context.Context, token string) ([]store.GameRecord, error) {
	games, err := h.repo.ListGames(ctx)
	if err != nil {
		return nil, err
	}
	for i := range games {
		if games[i].GameDate == "" {
			games[i].GameDate = h.backfillGameDate(ctx, games[i])
		}
		games[i].AnalysisStatus = string(h.gameAnalysisStatus(token, games[i]))
	}
	return games, nil
}

func (h *Handler) backfillGameDate(ctx context.Context, record store.GameRecord) string {
	sgfText, err := h.files.ReadSGF(record.SGFFilename)
	if err != nil {
		return ""
	}
	doc, err := game.ParseSGF(sgfText)
	if err != nil || doc.GameDate == "" {
		return ""
	}
	_ = h.repo.UpdateGameDate(ctx, record.ID, doc.GameDate)
	return doc.GameDate
}

func (h *Handler) gameAnalysisStatus(token string, record store.GameRecord) AnalysisState {
	ws := h.workspaces.ForToken(token)
	if ws.HasGame(record.ID) {
		state := ws.AnalysisState(record.ID)
		if state != AnalysisIdle {
			return state
		}
	}
	if _, err := h.files.ReadAnalysis(record.SGFFilename); err == nil {
		return AnalysisComplete
	}
	return AnalysisIdle
}
