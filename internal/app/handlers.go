package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"

	"github.com/gorilla/websocket"

	"jcgo/internal/game"
	"jcgo/internal/katago"
	"jcgo/internal/server"
	"jcgo/internal/store"
	"jcgo/internal/worker"
)

type AnalysisController interface {
	StartGame(StartInput)
	StopGame(token, gameID string)
	RestartGame(StartInput)
	AnalyzeNow(StartInput)
	Subscribe(Subscriber) func()
	Status() katago.Status
}

type WorkerStatusProvider interface {
	StatusSnapshot() worker.StatusSnapshot
}

type Handler struct {
	repo         *store.Repository
	files        store.FileStore
	workspaces   *WorkspaceStore
	analysis     AnalysisController
	workerStatus WorkerStatusProvider
	yuanluobo    YuanluoboBackend
}

type HandlerOptions struct {
	YuanluoboAuthStore   YuanluoboAuthStore
	YuanluoboHTTPClient  *http.Client
	YuanluoboBaseURL     string
	WorkerStatusProvider WorkerStatusProvider
}

type ImportResult struct {
	Game     store.GameRecord `json:"game"`
	Snapshot game.Snapshot    `json:"snapshot"`
}

type ListResult struct {
	Games []store.GameRecord `json:"games"`
}

type GameResult struct {
	Game store.GameRecord `json:"game"`
}

type SnapshotResult struct {
	Snapshot game.Snapshot `json:"snapshot"`
}

type DeleteResult struct {
	GameID string `json:"gameId"`
}

type BadMovePromptResult struct {
	Prompt string `json:"prompt"`
}

func NewHandler(repo *store.Repository, files store.FileStore, workspaces *WorkspaceStore, analysis AnalysisController) *Handler {
	return NewHandlerWithOptions(repo, files, workspaces, analysis, HandlerOptions{})
}

func NewHandlerWithOptions(repo *store.Repository, files store.FileStore, workspaces *WorkspaceStore, analysis AnalysisController, opts HandlerOptions) *Handler {
	authStore := opts.YuanluoboAuthStore
	if authStore == nil {
		authStore = NewYuanluoboMemoryAuthStore()
	}
	ylb := NewYuanluoboService(YuanluoboServiceOptions{
		AuthStore:  authStore,
		HTTPClient: opts.YuanluoboHTTPClient,
		BaseURL:    opts.YuanluoboBaseURL,
	})
	h := &Handler{repo: repo, files: files, workspaces: workspaces, analysis: analysis, workerStatus: opts.WorkerStatusProvider, yuanluobo: ylb}
	if analysis != nil {
		analysis.Subscribe(func(event Event) {
			ws := h.workspaces.ForToken(event.Token)
			if event.Error != "" {
				ws.SetAnalysisError(event.GameID, event.Error)
				return
			}
			ws.SetAnalysis(event.GameID, event.NodeID, event.Analysis)
			if !event.IsDuringSearch && strings.HasPrefix(event.NodeID, "main:") {
				h.persistMainlineAnalysis(context.Background(), event.GameID, ws)
			}
		})
	}
	return h
}

func (h *Handler) Call(ctx context.Context, token string, method string, params json.RawMessage) (any, error) {
	switch method {
	case "game.list":
		games, err := h.listGames(ctx, token)
		return ListResult{Games: games}, err
	case "game.importSgf":
		return h.importSGF(ctx, token, params)
	case "game.delete":
		return h.delete(ctx, token, params)
	case "game.select":
		return h.selectGame(ctx, token, params)
	case "game.setAnalysisWorker":
		return h.setGameAnalysisWorker(ctx, token, params)
	case "game.goto":
		return h.gotoMain(ctx, token, params)
	case "game.gotoNode":
		return h.gotoNode(ctx, token, params)
	case "game.play":
		return h.play(ctx, token, params)
	case "game.pass":
		return h.pass(ctx, token, params)
	case "game.backToMain":
		return h.backToMain(ctx, token, params)
	case "game.deleteVariationNode":
		return h.deleteVariationNode(ctx, token, params)
	case "game.clearVariation":
		return h.clearVariation(ctx, token, params)
	case "workspace.state":
		return h.workspaceState(ctx, token)
	case "workspace.snapshot":
		return h.workspaceSnapshot(ctx, token, params)
	case "worker.configure":
		return h.configureWorker(ctx, params)
	case "analysis.start":
		return h.analysisCall(ctx, token, params, "start")
	case "analysis.stop":
		return h.analysisCall(ctx, token, params, "stop")
	case "analysis.restart":
		return h.analysisCall(ctx, token, params, "restart")
	case "analysis.badMovePrompt":
		return h.badMovePrompt(ctx, token, params)
	case "yuanluobo.loginStart":
		return h.yuanluoboLoginStart(ctx)
	case "yuanluobo.loginPoll":
		return h.yuanluoboLoginPoll(ctx, params)
	case "yuanluobo.status":
		return h.yuanluobo.Status(ctx)
	case "yuanluobo.logout":
		return nil, h.yuanluobo.Logout(ctx)
	case "yuanluobo.players":
		return h.yuanluobo.Players(ctx)
	case "yuanluobo.records":
		return h.yuanluoboRecords(ctx, params)
	case "yuanluobo.importRecord":
		return h.yuanluoboImportRecord(ctx, token, params)
	default:
		return nil, errors.New("method not found")
	}
}

func (h *Handler) ServeWS(token string, conn *websocket.Conn) {
	defer conn.Close()
	var writeMu sync.Mutex
	ctx := context.Background()
	if h.analysis != nil {
		unsubscribe := h.analysis.Subscribe(func(event Event) {
			if event.Token != token {
				return
			}
			ws := h.workspaces.ForToken(event.Token)
			if event.Error != "" {
				ws.SetAnalysisError(event.GameID, event.Error)
			} else {
				ws.SetAnalysis(event.GameID, event.NodeID, event.Analysis)
			}
			state, err := h.workspaceState(ctx, token)
			if err != nil {
				return
			}
			writeMu.Lock()
			defer writeMu.Unlock()
			_ = conn.WriteJSON(server.Notify("analysis.update", state))
		})
		defer unsubscribe()
	}
	for {
		var req server.Request
		if err := conn.ReadJSON(&req); err != nil {
			return
		}
		id := requestID(req.ID)
		result, err := h.Call(ctx, token, req.Method, req.Params)
		writeMu.Lock()
		if err != nil {
			_ = conn.WriteJSON(server.ErrorResponse(id, server.CodeInternalError, err.Error()))
			writeMu.Unlock()
			continue
		}
		_ = conn.WriteJSON(server.ResultResponse(id, result))
		writeMu.Unlock()
	}
}

func (h *Handler) importSGF(ctx context.Context, token string, params json.RawMessage) (ImportResult, error) {
	var in importParams
	if err := decodeParams(params, &in); err != nil {
		return ImportResult{}, err
	}

	var sgfText string
	var displayName string

	if in.URL != "" {
		fetchedSGF, fetchedName, err := fetchFromURL(in.URL)
		if err != nil {
			return ImportResult{}, err
		}
		sgfText = fetchedSGF
		displayName = fetchedName
	} else if in.SGFText != "" {
		sgfText = in.SGFText
		displayName = strings.TrimSpace(in.DisplayName)
		if displayName == "" {
			return ImportResult{}, errors.New("displayName is required")
		}
	} else {
		return ImportResult{}, errors.New("either url or sgfText is required")
	}

	return h.importSGFText(ctx, token, sgfText, displayName, store.CreateGameInput{})
}

func (h *Handler) importSGFText(ctx context.Context, token string, sgfText string, displayName string, create store.CreateGameInput) (ImportResult, error) {
	doc, err := game.ParseSGF(sgfText)
	if err != nil {
		return ImportResult{}, err
	}
	create.DisplayName = displayName
	create.Result = doc.Result
	create.GameDate = doc.GameDate
	create.BlackName = doc.BlackName
	create.WhiteName = doc.WhiteName
	record, err := h.repo.CreateGame(ctx, create)
	if err != nil {
		return ImportResult{}, err
	}
	record.AnalysisStatus = string(AnalysisIdle)
	if _, err := h.files.WriteSGF(record.SGFFilename, sgfText); err != nil {
		_ = h.repo.DeleteGame(ctx, record.ID)
		return ImportResult{}, err
	}
	ws := h.workspaces.ForToken(token)
	if err := ws.LoadGame(record.ID, doc); err != nil {
		_ = h.repo.DeleteGame(ctx, record.ID)
		_ = h.files.DeleteSGF(record.SGFFilename)
		return ImportResult{}, err
	}
	snapshot, err := ws.CurrentSnapshot(record.ID)
	if err != nil {
		return ImportResult{}, err
	}
	return ImportResult{Game: record, Snapshot: snapshot}, nil
}

func (h *Handler) delete(ctx context.Context, token string, params json.RawMessage) (DeleteResult, error) {
	var in gameIDParams
	if err := decodeParams(params, &in); err != nil {
		return DeleteResult{}, err
	}
	record, err := h.repo.GetGame(ctx, in.GameID)
	if err != nil {
		return DeleteResult{}, err
	}
	if err := h.repo.DeleteGame(ctx, in.GameID); err != nil {
		return DeleteResult{}, err
	}
	if err := h.files.DeleteSGF(record.SGFFilename); err != nil {
		return DeleteResult{}, err
	}
	if err := h.files.DeleteAnalysis(record.SGFFilename); err != nil {
		return DeleteResult{}, err
	}
	h.workspaces.ForToken(token).RemoveGame(in.GameID)
	return DeleteResult{GameID: in.GameID}, nil
}

func (h *Handler) selectGame(ctx context.Context, token string, params json.RawMessage) (any, error) {
	var in gameIDParams
	if err := decodeParams(params, &in); err != nil {
		return nil, err
	}
	ws, err := h.ensureWorkspaceGame(ctx, token, in.GameID)
	if err != nil {
		return nil, err
	}
	if _, err := ws.SelectGame(in.GameID); err != nil {
		return nil, err
	}
	return h.workspaceState(ctx, token)
}

func (h *Handler) setGameAnalysisWorker(ctx context.Context, token string, params json.RawMessage) (any, error) {
	var in gameAnalysisWorkerParams
	if err := decodeParams(params, &in); err != nil {
		return nil, err
	}
	workerName := strings.TrimSpace(in.WorkerName)
	if workerName == "" {
		return nil, errors.New("workerName is required")
	}
	ws, err := h.ensureWorkspaceGame(ctx, token, in.GameID)
	if err != nil {
		return nil, err
	}
	if err := h.repo.UpdateGameAnalysisWorker(ctx, in.GameID, workerName); err != nil {
		return nil, err
	}
	if _, err := ws.SelectGame(in.GameID); err != nil {
		return nil, err
	}
	return h.workspaceState(ctx, token)
}

func (h *Handler) gotoMain(ctx context.Context, token string, params json.RawMessage) (any, error) {
	var in gotoParams
	if err := decodeParams(params, &in); err != nil {
		return nil, err
	}
	ws, err := h.ensureWorkspaceGame(ctx, token, in.GameID)
	if err != nil {
		return nil, err
	}
	if _, err := ws.GotoMain(in.GameID, in.MoveNumber); err != nil {
		return nil, err
	}
	return h.workspaceState(ctx, token)
}

func (h *Handler) gotoNode(ctx context.Context, token string, params json.RawMessage) (any, error) {
	var in gotoNodeParams
	if err := decodeParams(params, &in); err != nil {
		return nil, err
	}
	ws, err := h.ensureWorkspaceGame(ctx, token, in.GameID)
	if err != nil {
		return nil, err
	}
	if _, err := ws.GotoNode(in.GameID, in.NodeID); err != nil {
		return nil, err
	}
	return h.workspaceState(ctx, token)
}

func (h *Handler) play(ctx context.Context, token string, params json.RawMessage) (any, error) {
	var in playParams
	if err := decodeParams(params, &in); err != nil {
		return nil, err
	}
	ws, err := h.ensureWorkspaceGame(ctx, token, in.GameID)
	if err != nil {
		return nil, err
	}
	snapshot, err := ws.Play(in.GameID, in.Move)
	if err == nil {
		h.analyzeCurrentNode(token, ws, in.GameID, snapshot.NodeID)
	}
	if err != nil {
		return nil, err
	}
	return h.workspaceState(ctx, token)
}

func (h *Handler) pass(ctx context.Context, token string, params json.RawMessage) (any, error) {
	var in gameIDParams
	if err := decodeParams(params, &in); err != nil {
		return nil, err
	}
	ws, err := h.ensureWorkspaceGame(ctx, token, in.GameID)
	if err != nil {
		return nil, err
	}
	snapshot, err := ws.Pass(in.GameID)
	if err == nil {
		h.analyzeCurrentNode(token, ws, in.GameID, snapshot.NodeID)
	}
	if err != nil {
		return nil, err
	}
	return h.workspaceState(ctx, token)
}

func (h *Handler) backToMain(ctx context.Context, token string, params json.RawMessage) (any, error) {
	var in gameIDParams
	if err := decodeParams(params, &in); err != nil {
		return nil, err
	}
	ws, err := h.ensureWorkspaceGame(ctx, token, in.GameID)
	if err != nil {
		return nil, err
	}
	if _, err := ws.BackToMain(in.GameID); err != nil {
		return nil, err
	}
	return h.workspaceState(ctx, token)
}

func (h *Handler) deleteVariationNode(ctx context.Context, token string, params json.RawMessage) (any, error) {
	var in gameIDParams
	if err := decodeParams(params, &in); err != nil {
		return nil, err
	}
	ws, err := h.ensureWorkspaceGame(ctx, token, in.GameID)
	if err != nil {
		return nil, err
	}
	if _, err := ws.DeleteVariationNode(in.GameID); err != nil {
		return nil, err
	}
	return h.workspaceState(ctx, token)
}

func (h *Handler) clearVariation(ctx context.Context, token string, params json.RawMessage) (any, error) {
	var in gameIDParams
	if err := decodeParams(params, &in); err != nil {
		return nil, err
	}
	ws, err := h.ensureWorkspaceGame(ctx, token, in.GameID)
	if err != nil {
		return nil, err
	}
	if _, err := ws.ClearVariation(in.GameID); err != nil {
		return nil, err
	}
	return h.workspaceState(ctx, token)
}

func (h *Handler) workspaceSnapshot(ctx context.Context, token string, params json.RawMessage) (SnapshotResult, error) {
	var in gameIDParams
	if err := decodeParams(params, &in); err != nil {
		return SnapshotResult{}, err
	}
	ws, err := h.ensureWorkspaceGame(ctx, token, in.GameID)
	if err != nil {
		return SnapshotResult{}, err
	}
	snapshot, err := ws.CurrentSnapshot(in.GameID)
	return SnapshotResult{Snapshot: snapshot}, err
}

func (h *Handler) configureWorker(ctx context.Context, params json.RawMessage) (worker.StatusSnapshot, error) {
	var in workerConfigureParams
	if err := decodeParams(params, &in); err != nil {
		return worker.StatusSnapshot{}, err
	}
	workerName := strings.TrimSpace(in.WorkerName)
	if workerName == "" {
		return worker.StatusSnapshot{}, errors.New("workerName is required")
	}
	if strings.TrimSpace(in.Model) == "" {
		return worker.StatusSnapshot{}, errors.New("model is required")
	}
	if in.MaxVisits <= 0 {
		return worker.StatusSnapshot{}, errors.New("maxVisits must be positive")
	}
	if _, err := h.repo.UpsertWorkerConfig(ctx, store.WorkerConfigInput{Name: workerName, Model: in.Model, MaxVisits: in.MaxVisits}); err != nil {
		return worker.StatusSnapshot{}, err
	}
	return h.currentWorkerStatus(ctx)
}

func (h *Handler) analysisCall(ctx context.Context, token string, params json.RawMessage, action string) (any, error) {
	var in gameIDParams
	if err := decodeParams(params, &in); err != nil {
		return nil, err
	}
	if h.analysis == nil {
		return nil, errors.New("analysis is unavailable")
	}
	ws, err := h.ensureWorkspaceGame(ctx, token, in.GameID)
	if err != nil {
		return nil, err
	}
	snapshot, err := ws.CurrentSnapshot(in.GameID)
	if err != nil {
		return nil, err
	}
	workerName := ""
	if action == "start" || action == "restart" {
		workerName, err = h.requireGameAnalysisWorker(ctx, in.GameID)
		if err != nil {
			return nil, err
		}
	}
	input := StartInput{
		Token:       token,
		GameID:      in.GameID,
		WorkerName:  workerName,
		FocusNodeID: snapshot.NodeID,
		Nodes:       ws.MissingMainlineAnalysisInputs(in.GameID),
	}
	switch action {
	case "start":
		ws.MarkAnalysisStarted(in.GameID)
		h.analysis.StartGame(input)
	case "stop":
		h.analysis.StopGame(token, in.GameID)
		ws.MarkAnalysisStopped(in.GameID)
	case "restart":
		snapshot, err = ws.ClearAnalysisAndVariations(in.GameID, snapshot.NodeID)
		if err != nil {
			return nil, err
		}
		record, err := h.repo.GetGame(ctx, in.GameID)
		if err != nil {
			return nil, err
		}
		if err := h.files.DeleteAnalysis(record.SGFFilename); err != nil {
			return nil, err
		}
		input.FocusNodeID = snapshot.NodeID
		input.Nodes = ws.MainlineAnalysisInputs(in.GameID)
		ws.MarkAnalysisStarted(in.GameID)
		h.analysis.RestartGame(input)
	}
	return h.workspaceState(ctx, token)
}

func (h *Handler) requireGameAnalysisWorker(ctx context.Context, gameID string) (string, error) {
	record, err := h.repo.GetGame(ctx, gameID)
	if err != nil {
		return "", err
	}
	workerName := strings.TrimSpace(record.AnalysisWorkerName)
	if workerName == "" {
		return "", errors.New("analysis worker is required")
	}
	if err := h.requireWorkerReady(ctx, workerName); err != nil {
		return "", err
	}
	return workerName, nil
}

func (h *Handler) requireWorkerReady(ctx context.Context, workerName string) error {
	status, err := h.currentWorkerStatus(ctx)
	if err != nil {
		return err
	}
	for _, runtime := range status.Workers {
		if runtime.Name != workerName {
			continue
		}
		if runtime.Available && runtime.Error == "" {
			return nil
		}
		if runtime.Error != "" {
			return fmt.Errorf("analysis worker %s is unavailable: %s", workerName, runtime.Error)
		}
		return fmt.Errorf("analysis worker %s is unavailable", workerName)
	}
	return fmt.Errorf("analysis worker %s is not connected", workerName)
}

func (h *Handler) badMovePrompt(ctx context.Context, token string, params json.RawMessage) (BadMovePromptResult, error) {
	var in badMovePromptParams
	if err := decodeParams(params, &in); err != nil {
		return BadMovePromptResult{}, err
	}
	ws, err := h.ensureWorkspaceGame(ctx, token, in.GameID)
	if err != nil {
		return BadMovePromptResult{}, err
	}
	prompt, err := ws.BadMovePrompt(in.GameID, in.NodeID)
	if err != nil {
		return BadMovePromptResult{}, err
	}
	return BadMovePromptResult{Prompt: prompt}, nil
}

func (h *Handler) ensureWorkspaceGame(ctx context.Context, token string, gameID string) (*Workspace, error) {
	ws := h.workspaces.ForToken(token)
	if ws.HasGame(gameID) {
		return ws, nil
	}
	record, err := h.repo.GetGame(ctx, gameID)
	if err != nil {
		return nil, err
	}
	sgfText, err := h.files.ReadSGF(record.SGFFilename)
	if err != nil {
		return nil, err
	}
	doc, err := game.ParseSGF(sgfText)
	if err != nil {
		return nil, err
	}
	if err := ws.LoadGame(gameID, doc); err != nil {
		return nil, err
	}
	h.loadPersistedAnalysis(ws, record)
	return ws, nil
}

func (h *Handler) analyzeCurrentNode(token string, ws *Workspace, gameID string, nodeID string) {
	if h.analysis == nil {
		return
	}
	input, ok := ws.CurrentAnalysisInput(gameID)
	if !ok || input.NodeID != nodeID {
		return
	}
	h.analysis.AnalyzeNow(StartInput{
		Token:       token,
		GameID:      gameID,
		FocusNodeID: nodeID,
		Nodes:       []NodeInput{input},
	})
}

func decodeParams(params json.RawMessage, out any) error {
	if len(params) == 0 {
		params = []byte(`{}`)
	}
	return json.Unmarshal(params, out)
}

func requestID(raw json.RawMessage) string {
	id := strings.TrimSpace(string(raw))
	return strings.Trim(id, `"`)
}

type importParams struct {
	DisplayName      string `json:"displayName"`
	OriginalFilename string `json:"originalFilename,omitempty"`
	SGFText          string `json:"sgfText,omitempty"`
	URL              string `json:"url,omitempty"`
}

type gameIDParams struct {
	GameID string `json:"gameId"`
}

type gameAnalysisWorkerParams struct {
	GameID     string `json:"gameId"`
	WorkerName string `json:"workerName"`
}

type gotoParams struct {
	GameID     string `json:"gameId"`
	MoveNumber int    `json:"moveNumber"`
}

type gotoNodeParams struct {
	GameID string `json:"gameId"`
	NodeID string `json:"nodeId"`
}

type playParams struct {
	GameID string `json:"gameId"`
	Move   string `json:"move"`
}

type badMovePromptParams struct {
	GameID string `json:"gameId"`
	NodeID string `json:"nodeId"`
}

type workerConfigureParams struct {
	WorkerName string `json:"workerName"`
	Model      string `json:"model"`
	MaxVisits  int    `json:"maxVisits"`
}
