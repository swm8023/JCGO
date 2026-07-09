package app

import (
	"context"

	"jcgo/internal/game"
	"jcgo/internal/store"
	"jcgo/internal/worker"
)

type AnalysisState string

const (
	AnalysisIdle        AnalysisState = "idle"
	AnalysisRunning     AnalysisState = "running"
	AnalysisStopped     AnalysisState = "stopped"
	AnalysisComplete    AnalysisState = "complete"
	AnalysisUnavailable AnalysisState = "unavailable"
)

type EmptyWorkspaceState struct {
	Type          string                `json:"type"`
	Schema        int                   `json:"schema"`
	Games         []store.GameRecord    `json:"games"`
	AnalysisState AnalysisState         `json:"analysisState"`
	AnalysisError string                `json:"analysisError,omitempty"`
	WorkerStatus  worker.StatusSnapshot `json:"workerStatus"`
}

func (h *Handler) workspaceState(ctx context.Context, token string) (any, error) {
	games, err := h.listGames(ctx, token)
	if err != nil {
		return nil, err
	}
	ws := h.workspaces.ForToken(token)
	selectedGameID := ws.SelectedGameID()
	if selectedGameID == "" {
		return EmptyWorkspaceState{Type: "state", Schema: 1, Games: games, AnalysisState: AnalysisIdle, WorkerStatus: h.currentWorkerStatus()}, nil
	}
	if _, err := h.ensureWorkspaceGame(ctx, token, selectedGameID); err != nil {
		return nil, err
	}
	payload, err := ws.StatePayload(selectedGameID)
	if err != nil {
		return nil, err
	}
	payload.Games = games
	payload.WorkerStatus = h.currentWorkerStatus()
	return payload, nil
}

func (h *Handler) currentWorkerStatus() worker.StatusSnapshot {
	if h.workerStatus == nil {
		return worker.StatusSnapshot{
			Workers: []worker.RuntimeStatus{},
		}
	}
	status := h.workerStatus.StatusSnapshot()
	if status.Workers == nil {
		status.Workers = []worker.RuntimeStatus{}
	}
	return status
}

func (h *Handler) listGames(ctx context.Context, token string) ([]store.GameRecord, error) {
	games, err := h.repo.ListGames(ctx)
	if err != nil {
		return nil, err
	}
	for i := range games {
		if games[i].GameDate == "" || games[i].BlackName == "" || games[i].WhiteName == "" {
			games[i] = h.backfillGameMetadata(ctx, games[i])
		}
		games[i].AnalysisStatus = string(h.gameAnalysisStatus(games[i]))
	}
	return games, nil
}

func (h *Handler) backfillGameMetadata(ctx context.Context, record store.GameRecord) store.GameRecord {
	sgfText, err := h.files.ReadSGF(record.SGFFilename)
	if err != nil {
		return record
	}
	doc, err := game.ParseSGF(sgfText)
	if err != nil {
		return record
	}
	if record.GameDate == "" {
		record.GameDate = doc.GameDate
	}
	if record.BlackName == "" {
		record.BlackName = doc.BlackName
	}
	if record.WhiteName == "" {
		record.WhiteName = doc.WhiteName
	}
	_ = h.repo.UpdateGameMetadata(ctx, record.ID, record.GameDate, record.BlackName, record.WhiteName)
	return record
}

func (h *Handler) gameAnalysisStatus(record store.GameRecord) AnalysisState {
	if h.files.AnalysisExists(record.SGFFilename) {
		return AnalysisComplete
	}
	return AnalysisIdle
}
