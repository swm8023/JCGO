package app

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"jcgo/internal/game"
	"jcgo/internal/server"
	"jcgo/internal/store"
)

func TestImportListRenameDeleteGame(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	repo, err := store.Open(ctx, filepath.Join(dir, "jcgo.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	handler := NewHandler(repo, store.NewFileStore(filepath.Join(dir, "games")), NewWorkspaceStore(), nil)

	result, err := handler.Call(ctx, "secret", "game.importSgf", json.RawMessage(`{"displayName":"Demo","originalFilename":"demo.sgf","sgfText":"(;GM[1]FF[4]SZ[19]RE[B+R];B[pd])"}`))
	if err != nil {
		t.Fatal(err)
	}
	imported := result.(ImportResult)
	if imported.Game.DisplayName != "Demo" || imported.Game.Result != "B+R" || imported.Snapshot.MoveNumber != 0 {
		t.Fatalf("imported = %#v", imported)
	}
	if imported.Game.SGFFilename != imported.Game.ID+".sgf" {
		t.Fatalf("sgf filename = %q, id = %q", imported.Game.SGFFilename, imported.Game.ID)
	}
	if _, err := os.Stat(filepath.Join(dir, "games", imported.Game.SGFFilename)); err != nil {
		t.Fatal(err)
	}

	if _, err := handler.Call(ctx, "secret", "game.rename", json.RawMessage(`{"gameId":"`+imported.Game.ID+`","displayName":"Renamed"}`)); err != nil {
		t.Fatal(err)
	}
	listResult, err := handler.Call(ctx, "secret", "game.list", nil)
	if err != nil {
		t.Fatal(err)
	}
	if listResult.(ListResult).Games[0].DisplayName != "Renamed" {
		t.Fatalf("list = %#v", listResult)
	}

	if _, err := handler.Call(ctx, "secret", "game.delete", json.RawMessage(`{"gameId":"`+imported.Game.ID+`"}`)); err != nil {
		t.Fatal(err)
	}
	listResult, err = handler.Call(ctx, "secret", "game.list", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(listResult.(ListResult).Games) != 0 {
		t.Fatalf("list after delete = %#v", listResult)
	}
	if _, err := os.Stat(filepath.Join(dir, "games", imported.Game.SGFFilename)); !os.IsNotExist(err) {
		t.Fatalf("expected sgf deletion, stat err = %v", err)
	}
}

func TestGameListEncodesEmptyGamesAsArray(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	repo, err := store.Open(ctx, filepath.Join(dir, "jcgo.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	handler := NewHandler(repo, store.NewFileStore(filepath.Join(dir, "games")), NewWorkspaceStore(), nil)

	result, err := handler.Call(ctx, "secret", "game.list", nil)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"games":[]`) {
		t.Fatalf("empty game list JSON = %s, want games array", raw)
	}
}

func TestImportRejectsEmptyDisplayName(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	repo, err := store.Open(ctx, filepath.Join(dir, "jcgo.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	handler := NewHandler(repo, store.NewFileStore(filepath.Join(dir, "games")), NewWorkspaceStore(), nil)

	_, err = handler.Call(ctx, "secret", "game.importSgf", json.RawMessage(`{"displayName":" ","originalFilename":"demo.sgf","sgfText":"(;GM[1]FF[4]SZ[19];B[pd])"}`))
	if err == nil {
		t.Fatal("expected empty display name rejection")
	}
}

func TestAnalysisStartStoresResultInWorkspace(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	repo, err := store.Open(ctx, filepath.Join(dir, "jcgo.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	workspaces := NewWorkspaceStore()
	scheduler := NewScheduler(&fakeAnalyzer{}, 500)
	defer scheduler.Close()
	handler := NewHandler(repo, store.NewFileStore(filepath.Join(dir, "games")), workspaces, scheduler)

	result, err := handler.Call(ctx, "secret", "game.importSgf", json.RawMessage(`{"displayName":"Demo","sgfText":"(;GM[1]FF[4]SZ[19];B[pd])"}`))
	if err != nil {
		t.Fatal(err)
	}
	gameID := result.(ImportResult).Game.ID
	if _, err := handler.Call(ctx, "secret", "analysis.start", json.RawMessage(`{"gameId":"`+gameID+`"}`)); err != nil {
		t.Fatal(err)
	}

	deadline := time.After(time.Second)
	for {
		snap, err := workspaces.ForToken("secret").CurrentSnapshot(gameID)
		if err != nil {
			t.Fatal(err)
		}
		if snap.Analysis != nil && len(snap.Analysis.Candidates) == 1 {
			return
		}
		select {
		case <-deadline:
			t.Fatalf("analysis not stored in snapshot: %#v", snap)
		default:
			time.Sleep(10 * time.Millisecond)
		}
	}
}

func TestWorkspaceStateRestoresSelectedSnapshotAndAnalysisView(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	repo, err := store.Open(ctx, filepath.Join(dir, "jcgo.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	workspaces := NewWorkspaceStore()
	handler := NewHandler(repo, store.NewFileStore(filepath.Join(dir, "games")), workspaces, nil)

	result, err := handler.Call(ctx, "secret", "game.importSgf", json.RawMessage(`{"displayName":"Demo","sgfText":"(;GM[1]FF[4]SZ[19];B[pd];W[dd])"}`))
	if err != nil {
		t.Fatal(err)
	}
	imported := result.(ImportResult)
	gameID := imported.Game.ID
	if _, err := handler.Call(ctx, "secret", "game.goto", json.RawMessage(`{"gameId":"`+gameID+`","moveNumber":1}`)); err != nil {
		t.Fatal(err)
	}

	ws := workspaces.ForToken("secret")
	ws.SetAnalysis(gameID, "main:0", game.AnalysisResult{
		Winrate:   0.42,
		ScoreLead: 2.1,
		Visits:    500,
		Candidates: []game.CandidateMove{
			{Move: "Q16", Order: 0, Visits: 500, Winrate: 0.42, ScoreLead: 2.1, PointLoss: 0},
			{Move: "D4", Order: 1, Visits: 50, Winrate: 0.30, ScoreLead: -10, PointLoss: 12},
		},
	})
	ws.SetAnalysis(gameID, "main:1", game.AnalysisResult{
		Winrate:   0.56,
		ScoreLead: -1.4,
		Visits:    500,
		Candidates: []game.CandidateMove{
			{Move: "D4", Order: 0, Visits: 500, Winrate: 0.56, ScoreLead: -1.4, PointLoss: 0},
		},
	})

	state := callWorkspaceState(t, handler, ctx, "secret")
	if state.SelectedGameID != gameID {
		t.Fatalf("selected game = %q, want %q", state.SelectedGameID, gameID)
	}
	if state.Snapshot == nil || state.Snapshot.MoveNumber != 1 {
		t.Fatalf("snapshot = %#v", state.Snapshot)
	}
	if state.Snapshot.Analysis == nil || state.Snapshot.Analysis.Winrate != 0.56 {
		t.Fatalf("snapshot analysis = %#v", state.Snapshot.Analysis)
	}
	if len(state.ChartPoints) != 2 || state.ChartPoints[0].MoveNumber != 0 || state.ChartPoints[1].MoveNumber != 1 {
		t.Fatalf("chart points = %#v", state.ChartPoints)
	}
	if len(state.BadMoves) != 1 || state.BadMoves[0].MoveNumber != 1 || state.BadMoves[0].Move != "Q16" || state.BadMoves[0].Color != game.Black || state.BadMoves[0].PointLoss != 3.5 {
		t.Fatalf("bad moves = %#v", state.BadMoves)
	}
}

func TestAnalysisNotificationPushesFullWorkspaceState(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	repo, err := store.Open(ctx, filepath.Join(dir, "jcgo.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	scheduler := NewScheduler(&fakeAnalyzer{}, 500)
	defer scheduler.Close()
	handler := NewHandler(repo, store.NewFileStore(filepath.Join(dir, "games")), NewWorkspaceStore(), scheduler)

	result, err := handler.Call(ctx, "secret", "game.importSgf", json.RawMessage(`{"displayName":"Demo","sgfText":"(;GM[1]FF[4]SZ[19];B[pd])"}`))
	if err != nil {
		t.Fatal(err)
	}
	gameID := result.(ImportResult).Game.ID

	srv := httptest.NewServer(server.New(server.Config{AccessToken: "secret"}, handler).Handler())
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	dialer := websocket.Dialer{Subprotocols: []string{"jcgo-jsonrpc", "token.secret"}}
	conn, _, err := dialer.Dial(url, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	if _, err := handler.Call(ctx, "secret", "analysis.start", json.RawMessage(`{"gameId":"`+gameID+`"}`)); err != nil {
		t.Fatal(err)
	}

	var notification struct {
		Method string         `json:"method"`
		Params workspaceState `json:"params"`
	}
	if err := conn.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := conn.ReadJSON(&notification); err != nil {
		t.Fatal(err)
	}
	if notification.Method != "analysis.update" {
		t.Fatalf("method = %q", notification.Method)
	}
	if notification.Params.SelectedGameID != gameID || len(notification.Params.ChartPoints) == 0 || notification.Params.Snapshot == nil {
		t.Fatalf("notification params = %#v", notification.Params)
	}
}

type workspaceState struct {
	Games          []store.GameRecord `json:"games"`
	SelectedGameID string             `json:"selectedGameId"`
	Snapshot       *game.Snapshot     `json:"snapshot"`
	ChartPoints    []game.ChartPoint  `json:"chartPoints"`
	BadMoves       []game.BadMove     `json:"badMoves"`
	AnalysisState  string             `json:"analysisState"`
}

func callWorkspaceState(t *testing.T, handler *Handler, ctx context.Context, token string) workspaceState {
	t.Helper()
	result, err := handler.Call(ctx, token, "workspace.state", nil)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	var state workspaceState
	if err := json.Unmarshal(raw, &state); err != nil {
		t.Fatal(err)
	}
	return state
}
