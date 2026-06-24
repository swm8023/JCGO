package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/gorilla/websocket"

	"jcgo/internal/game"
	"jcgo/internal/server"
	"jcgo/internal/store"
)

type AnalysisController interface {
	Start(gameID string, focusNodeID string) error
	Stop(gameID string) error
	Restart(gameID string, focusNodeID string) error
}

type Handler struct {
	repo       *store.Repository
	files      store.FileStore
	workspaces *WorkspaceStore
	analysis   AnalysisController
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

func NewHandler(repo *store.Repository, files store.FileStore, workspaces *WorkspaceStore, analysis AnalysisController) *Handler {
	return &Handler{repo: repo, files: files, workspaces: workspaces, analysis: analysis}
}

func (h *Handler) Call(ctx context.Context, token string, method string, params json.RawMessage) (any, error) {
	switch method {
	case "game.list":
		games, err := h.repo.ListGames(ctx)
		return ListResult{Games: games}, err
	case "game.importSgf":
		return h.importSGF(ctx, token, params)
	case "game.rename":
		return h.rename(ctx, params)
	case "game.delete":
		return h.delete(ctx, token, params)
	case "game.select":
		return h.selectGame(ctx, token, params)
	case "game.goto":
		return h.gotoMain(ctx, token, params)
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
	case "workspace.snapshot":
		return h.workspaceSnapshot(ctx, token, params)
	case "analysis.start":
		return h.analysisCall(ctx, token, params, "start")
	case "analysis.stop":
		return h.analysisCall(ctx, token, params, "stop")
	case "analysis.restart":
		return h.analysisCall(ctx, token, params, "restart")
	default:
		return nil, errors.New("method not found")
	}
}

func (h *Handler) ServeWS(token string, conn *websocket.Conn) {
	defer conn.Close()
	ctx := context.Background()
	for {
		var req server.Request
		if err := conn.ReadJSON(&req); err != nil {
			return
		}
		id := requestID(req.ID)
		result, err := h.Call(ctx, token, req.Method, req.Params)
		if err != nil {
			_ = conn.WriteJSON(server.ErrorResponse(id, server.CodeInternalError, err.Error()))
			continue
		}
		_ = conn.WriteJSON(server.ResultResponse(id, result))
	}
}

func (h *Handler) importSGF(ctx context.Context, token string, params json.RawMessage) (ImportResult, error) {
	var in importParams
	if err := decodeParams(params, &in); err != nil {
		return ImportResult{}, err
	}
	displayName := strings.TrimSpace(in.DisplayName)
	if displayName == "" {
		return ImportResult{}, errors.New("displayName is required")
	}
	doc, err := game.ParseSGF(in.SGFText)
	if err != nil {
		return ImportResult{}, err
	}
	record, err := h.repo.CreateGame(ctx, store.CreateGameInput{
		DisplayName: displayName,
		Result:      doc.Result,
	})
	if err != nil {
		return ImportResult{}, err
	}
	if _, err := h.files.WriteSGF(record.SGFFilename, in.SGFText); err != nil {
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

func (h *Handler) rename(ctx context.Context, params json.RawMessage) (GameResult, error) {
	var in renameParams
	if err := decodeParams(params, &in); err != nil {
		return GameResult{}, err
	}
	displayName := strings.TrimSpace(in.DisplayName)
	if displayName == "" {
		return GameResult{}, errors.New("displayName is required")
	}
	if err := h.repo.RenameGame(ctx, in.GameID, displayName); err != nil {
		return GameResult{}, err
	}
	record, err := h.repo.GetGame(ctx, in.GameID)
	if err != nil {
		return GameResult{}, err
	}
	return GameResult{Game: record}, nil
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
	h.workspaces.ForToken(token).RemoveGame(in.GameID)
	return DeleteResult{GameID: in.GameID}, nil
}

func (h *Handler) selectGame(ctx context.Context, token string, params json.RawMessage) (SnapshotResult, error) {
	var in gameIDParams
	if err := decodeParams(params, &in); err != nil {
		return SnapshotResult{}, err
	}
	ws, err := h.ensureWorkspaceGame(ctx, token, in.GameID)
	if err != nil {
		return SnapshotResult{}, err
	}
	snapshot, err := ws.SelectGame(in.GameID)
	return SnapshotResult{Snapshot: snapshot}, err
}

func (h *Handler) gotoMain(ctx context.Context, token string, params json.RawMessage) (SnapshotResult, error) {
	var in gotoParams
	if err := decodeParams(params, &in); err != nil {
		return SnapshotResult{}, err
	}
	ws, err := h.ensureWorkspaceGame(ctx, token, in.GameID)
	if err != nil {
		return SnapshotResult{}, err
	}
	snapshot, err := ws.GotoMain(in.GameID, in.MoveNumber)
	return SnapshotResult{Snapshot: snapshot}, err
}

func (h *Handler) play(ctx context.Context, token string, params json.RawMessage) (SnapshotResult, error) {
	var in playParams
	if err := decodeParams(params, &in); err != nil {
		return SnapshotResult{}, err
	}
	ws, err := h.ensureWorkspaceGame(ctx, token, in.GameID)
	if err != nil {
		return SnapshotResult{}, err
	}
	snapshot, err := ws.Play(in.GameID, in.Move)
	return SnapshotResult{Snapshot: snapshot}, err
}

func (h *Handler) pass(ctx context.Context, token string, params json.RawMessage) (SnapshotResult, error) {
	var in gameIDParams
	if err := decodeParams(params, &in); err != nil {
		return SnapshotResult{}, err
	}
	ws, err := h.ensureWorkspaceGame(ctx, token, in.GameID)
	if err != nil {
		return SnapshotResult{}, err
	}
	snapshot, err := ws.Pass(in.GameID)
	return SnapshotResult{Snapshot: snapshot}, err
}

func (h *Handler) backToMain(ctx context.Context, token string, params json.RawMessage) (SnapshotResult, error) {
	var in gameIDParams
	if err := decodeParams(params, &in); err != nil {
		return SnapshotResult{}, err
	}
	ws, err := h.ensureWorkspaceGame(ctx, token, in.GameID)
	if err != nil {
		return SnapshotResult{}, err
	}
	snapshot, err := ws.BackToMain(in.GameID)
	return SnapshotResult{Snapshot: snapshot}, err
}

func (h *Handler) deleteVariationNode(ctx context.Context, token string, params json.RawMessage) (SnapshotResult, error) {
	var in gameIDParams
	if err := decodeParams(params, &in); err != nil {
		return SnapshotResult{}, err
	}
	ws, err := h.ensureWorkspaceGame(ctx, token, in.GameID)
	if err != nil {
		return SnapshotResult{}, err
	}
	snapshot, err := ws.DeleteVariationNode(in.GameID)
	return SnapshotResult{Snapshot: snapshot}, err
}

func (h *Handler) clearVariation(ctx context.Context, token string, params json.RawMessage) (SnapshotResult, error) {
	var in gameIDParams
	if err := decodeParams(params, &in); err != nil {
		return SnapshotResult{}, err
	}
	ws, err := h.ensureWorkspaceGame(ctx, token, in.GameID)
	if err != nil {
		return SnapshotResult{}, err
	}
	snapshot, err := ws.ClearVariation(in.GameID)
	return SnapshotResult{Snapshot: snapshot}, err
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

func (h *Handler) analysisCall(ctx context.Context, token string, params json.RawMessage, action string) (SnapshotResult, error) {
	var in gameIDParams
	if err := decodeParams(params, &in); err != nil {
		return SnapshotResult{}, err
	}
	ws, err := h.ensureWorkspaceGame(ctx, token, in.GameID)
	if err != nil {
		return SnapshotResult{}, err
	}
	snapshot, err := ws.CurrentSnapshot(in.GameID)
	if err != nil {
		return SnapshotResult{}, err
	}
	if h.analysis == nil {
		return SnapshotResult{}, errors.New("analysis is unavailable")
	}
	switch action {
	case "start":
		err = h.analysis.Start(in.GameID, snapshot.NodeID)
	case "stop":
		err = h.analysis.Stop(in.GameID)
	case "restart":
		err = h.analysis.Restart(in.GameID, snapshot.NodeID)
	}
	return SnapshotResult{Snapshot: snapshot}, err
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
	return ws, nil
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
	OriginalFilename string `json:"originalFilename"`
	SGFText          string `json:"sgfText"`
}

type renameParams struct {
	GameID      string `json:"gameId"`
	DisplayName string `json:"displayName"`
}

type gameIDParams struct {
	GameID string `json:"gameId"`
}

type gotoParams struct {
	GameID     string `json:"gameId"`
	MoveNumber int    `json:"moveNumber"`
}

type playParams struct {
	GameID string `json:"gameId"`
	Move   string `json:"move"`
}
