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
	Type             string                `json:"type"`
	Schema           int                   `json:"schema"`
	Games            []store.GameRecord    `json:"games"`
	AnalysisState    AnalysisState         `json:"analysisState"`
	AnalysisError    string                `json:"analysisError,omitempty"`
	WorkerStatus     worker.StatusSnapshot `json:"workerStatus"`
	AnalysisSchedule ScheduleSnapshot      `json:"analysisSchedule"`
}

func (h *Handler) workspaceState(ctx context.Context, token string) (any, error) {
	games, err := h.listGames(ctx, token)
	if err != nil {
		return nil, err
	}
	ws := h.workspaces.ForToken(token)
	workerStatus, err := h.currentWorkerStatus(ctx)
	if err != nil {
		return nil, err
	}
	schedule := h.analysisSchedule()
	selectedGameID := ws.SelectedGameID()
	if selectedGameID == "" {
		return EmptyWorkspaceState{Type: "state", Schema: 1, Games: games, AnalysisState: AnalysisIdle, WorkerStatus: workerStatus, AnalysisSchedule: schedule}, nil
	}
	if _, err := h.ensureWorkspaceGame(ctx, token, selectedGameID); err != nil {
		return nil, err
	}
	payload, err := ws.StatePayload(selectedGameID)
	if err != nil {
		return nil, err
	}
	payload.Games = games
	payload.WorkerStatus = workerStatus
	payload.AnalysisSchedule = schedule
	return payload, nil
}

func (h *Handler) analysisSchedule() ScheduleSnapshot {
	if h.analysis == nil {
		return ScheduleSnapshot{Lanes: []WorkerLaneSnapshot{}}
	}
	snapshot := h.analysis.Snapshot()
	if snapshot.Lanes == nil {
		snapshot.Lanes = []WorkerLaneSnapshot{}
	}
	return snapshot
}

func (h *Handler) currentWorkerStatus(ctx context.Context) (worker.StatusSnapshot, error) {
	status := worker.StatusSnapshot{
		Workers: []worker.RuntimeStatus{},
	}
	if h.workerStatus == nil {
		status.Workers = []worker.RuntimeStatus{}
	} else {
		status = h.workerStatus.StatusSnapshot()
	}
	if status.Workers == nil {
		status.Workers = []worker.RuntimeStatus{}
	}
	configs, err := h.repo.ListWorkerConfigs(ctx)
	if err != nil {
		return worker.StatusSnapshot{}, err
	}
	configByName := make(map[string]store.WorkerConfig, len(configs))
	for _, cfg := range configs {
		configByName[cfg.Name] = cfg
	}
	seen := make(map[string]bool, len(status.Workers))
	for i := range status.Workers {
		name := status.Workers[i].Name
		if name == "" {
			continue
		}
		cfg, ok := configByName[name]
		if !ok {
			cfg, err = h.repo.GetOrCreateWorkerConfig(ctx, name)
			if err != nil {
				return worker.StatusSnapshot{}, err
			}
		}
		status.Workers[i].Model = cfg.Model
		status.Workers[i].MaxVisits = cfg.MaxVisits
		status.Workers[i].Priority = cfg.Priority
		seen[name] = true
	}
	for _, cfg := range configs {
		if seen[cfg.Name] {
			continue
		}
		status.Workers = append(status.Workers, worker.RuntimeStatus{
			ID:        "config:" + cfg.Name,
			Name:      cfg.Name,
			Model:     cfg.Model,
			MaxVisits: cfg.MaxVisits,
			Priority:  cfg.Priority,
			Available: false,
		})
	}
	return status, nil
}

func (h *Handler) listGames(ctx context.Context, token string) ([]store.GameRecord, error) {
	games, err := h.repo.ListGames(ctx)
	if err != nil {
		return nil, err
	}
	ws := h.workspaces.ForToken(token)
	for i := range games {
		if games[i].GameDate == "" || games[i].BlackName == "" || games[i].WhiteName == "" {
			games[i] = h.backfillGameMetadata(ctx, games[i])
		}
		games[i].AnalysisStatus = string(h.gameAnalysisStatus(games[i], ws))
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

func (h *Handler) gameAnalysisStatus(record store.GameRecord, ws *Workspace) AnalysisState {
	if ws != nil {
		state := ws.AnalysisState(record.ID)
		if state == AnalysisRunning || state == AnalysisUnavailable {
			return state
		}
	}
	if h.files.AnalysisExists(record.SGFFilename) {
		return AnalysisComplete
	}
	if ws != nil && ws.AnalysisState(record.ID) == AnalysisStopped {
		return AnalysisStopped
	}
	return AnalysisIdle
}
