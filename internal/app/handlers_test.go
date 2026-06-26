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
	"jcgo/internal/katago"
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
	files := store.NewFileStore(filepath.Join(dir, "games"))
	handler := NewHandler(repo, files, NewWorkspaceStore(), nil)

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
	if _, err := files.WriteAnalysis(imported.Game.SGFFilename, []byte(`{"schema":1}`)); err != nil {
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
	if _, err := os.Stat(filepath.Join(dir, "games", imported.Game.ID+".analysis.json")); !os.IsNotExist(err) {
		t.Fatalf("expected analysis deletion, stat err = %v", err)
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
		payload, err := workspaces.ForToken("secret").StatePayload(gameID)
		if err != nil {
			t.Fatal(err)
		}
		if len(payload.Current.Candidates.Moves) == 1 {
			return
		}
		select {
		case <-deadline:
			t.Fatalf("analysis not stored in state: %#v", payload)
		default:
			time.Sleep(10 * time.Millisecond)
		}
	}
}

func TestAnalysisResultsPersistNextToSGFAndReloadInNewWorkspace(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	repo, err := store.Open(ctx, filepath.Join(dir, "jcgo.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	files := store.NewFileStore(filepath.Join(dir, "games"))
	scheduler := NewScheduler(&fakeAnalyzer{}, 500)
	defer scheduler.Close()
	handler := NewHandler(repo, files, NewWorkspaceStore(), scheduler)

	result, err := handler.Call(ctx, "secret", "game.importSgf", json.RawMessage(`{"displayName":"Demo","sgfText":"(;GM[1]FF[4]SZ[19];B[pd];W[dd])"}`))
	if err != nil {
		t.Fatal(err)
	}
	imported := result.(ImportResult)
	if _, err := handler.Call(ctx, "secret", "analysis.start", json.RawMessage(`{"gameId":"`+imported.Game.ID+`"}`)); err != nil {
		t.Fatal(err)
	}
	waitForAnalysisFile(t, files, imported.Game.SGFFilename, 3)

	raw, err := files.ReadAnalysis(imported.Game.SGFFilename)
	if err != nil {
		t.Fatal(err)
	}
	var saved struct {
		Nodes map[string]struct {
			Policy []float64 `json:"policy"`
		} `json:"nodes"`
	}
	if err := json.Unmarshal(raw, &saved); err != nil {
		t.Fatal(err)
	}
	if len(saved.Nodes["main:0"].Policy) != 2 || saved.Nodes["main:0"].Policy[0] != 0.2 || saved.Nodes["main:0"].Policy[1] != 0.8 {
		t.Fatalf("analysis file did not persist policy: %s", raw)
	}

	reloaded := NewHandler(repo, files, NewWorkspaceStore(), nil)
	state := callResult[StatePayload](t, reloaded, "secret", "game.select", map[string]any{"gameId": imported.Game.ID})
	if state.Timeline.RootVisits[0] == nil || *state.Timeline.RootVisits[0] != 500 {
		t.Fatalf("reloaded timeline = %#v", state.Timeline)
	}
	if state.Timeline.RootVisits[2] == nil || *state.Timeline.RootVisits[2] != 500 {
		t.Fatalf("reloaded final node = %#v", state.Timeline.RootVisits)
	}
}

func TestAnalysisStartSchedulesOnlyMissingPersistedMainlineNodes(t *testing.T) {
	h, token := newTestHandler(t)
	imported := callResult[ImportResult](t, h, token, "game.importSgf", map[string]any{
		"displayName": "Demo",
		"sgfText":     "(;GM[1]FF[4]SZ[19];B[pd];W[dd])",
	})
	if _, err := h.files.WriteAnalysis(imported.Game.SGFFilename, []byte(`{
		"schema":1,
		"gameId":"`+imported.Game.ID+`",
		"nodes":{
			"main:0":{"root":{"winrate":0.41,"scoreLead":1.2,"visits":123},"candidates":[{"move":"Q16","order":0,"visits":123,"winrate":0.41,"scoreLead":1.2,"pv":["Q16"]}],"policy":[0.3,0.7]}
		}
	}`)); err != nil {
		t.Fatal(err)
	}
	recorder := &recordingAnalysisController{}
	reloaded := NewHandler(h.repo, h.files, NewWorkspaceStore(), recorder)
	_ = callResult[StatePayload](t, reloaded, token, "game.select", map[string]any{"gameId": imported.Game.ID})

	_ = callResult[StatePayload](t, reloaded, token, "analysis.start", map[string]any{"gameId": imported.Game.ID})
	if len(recorder.started) != 1 {
		t.Fatalf("starts = %#v", recorder.started)
	}
	got := nodeIDs(recorder.started[0].Nodes)
	want := []string{"main:1", "main:2"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("scheduled nodes = %v, want %v", got, want)
	}
}

func TestAnalysisRestartDeletesPersistedAnalysisAndSchedulesAllMainlineNodes(t *testing.T) {
	h, token := newTestHandler(t)
	imported := callResult[ImportResult](t, h, token, "game.importSgf", map[string]any{
		"displayName": "Demo",
		"sgfText":     "(;GM[1]FF[4]SZ[19];B[pd];W[dd])",
	})
	if _, err := h.files.WriteAnalysis(imported.Game.SGFFilename, []byte(`{"schema":1,"gameId":"`+imported.Game.ID+`","nodes":{"main:0":{"root":{"visits":10}}}}`)); err != nil {
		t.Fatal(err)
	}
	recorder := &recordingAnalysisController{}
	reloaded := NewHandler(h.repo, h.files, NewWorkspaceStore(), recorder)
	_ = callResult[StatePayload](t, reloaded, token, "game.select", map[string]any{"gameId": imported.Game.ID})

	_ = callResult[StatePayload](t, reloaded, token, "analysis.restart", map[string]any{"gameId": imported.Game.ID})
	if _, err := h.files.ReadAnalysis(imported.Game.SGFFilename); !os.IsNotExist(err) {
		t.Fatalf("expected deleted analysis file, err = %v", err)
	}
	if len(recorder.restarted) != 1 {
		t.Fatalf("restarts = %#v", recorder.restarted)
	}
	got := nodeIDs(recorder.restarted[0].Nodes)
	want := []string{"main:0", "main:1", "main:2"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("scheduled nodes = %v, want %v", got, want)
	}
}

func TestPlayVariationQueuesAnalysisForCurrentNode(t *testing.T) {
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

	result, err := handler.Call(ctx, "secret", "game.importSgf", json.RawMessage(`{"displayName":"Demo","sgfText":"(;GM[1]FF[4]SZ[19];B[pd];W[dd])"}`))
	if err != nil {
		t.Fatal(err)
	}
	gameID := result.(ImportResult).Game.ID
	if _, err := handler.Call(ctx, "secret", "game.goto", json.RawMessage(`{"gameId":"`+gameID+`","moveNumber":1}`)); err != nil {
		t.Fatal(err)
	}
	playResult, err := handler.Call(ctx, "secret", "game.play", json.RawMessage(`{"gameId":"`+gameID+`","move":"Q4"}`))
	if err != nil {
		t.Fatal(err)
	}
	if playResult.(StatePayload).Snapshot.NodeID != "var:1" {
		t.Fatalf("play result = %#v", playResult)
	}

	deadline := time.After(time.Second)
	for {
		payload, err := workspaces.ForToken("secret").StatePayload(gameID)
		if err != nil {
			t.Fatal(err)
		}
		if payload.Current.NodeID == "var:1" && len(payload.Current.Candidates.Moves) == 1 {
			return
		}
		select {
		case <-deadline:
			t.Fatalf("variation analysis not stored in state: %#v", payload)
		default:
			time.Sleep(10 * time.Millisecond)
		}
	}
}

func TestGotoNodeNavigatesVariation(t *testing.T) {
	h, token := newTestHandler(t)
	imported := callResult[ImportResult](t, h, token, "game.importSgf", map[string]any{
		"displayName": "Demo",
		"sgfText":     "(;GM[1]FF[4]SZ[19];B[pd];W[dd])",
	})
	_ = callResult[StatePayload](t, h, token, "game.goto", map[string]any{"gameId": imported.Game.ID, "moveNumber": 1})
	_ = callResult[StatePayload](t, h, token, "game.play", map[string]any{"gameId": imported.Game.ID, "move": "Q4"})
	_ = callResult[StatePayload](t, h, token, "game.play", map[string]any{"gameId": imported.Game.ID, "move": "D4"})
	_ = callResult[StatePayload](t, h, token, "game.backToMain", map[string]any{"gameId": imported.Game.ID})

	state := callResult[StatePayload](t, h, token, "game.gotoNode", map[string]any{"gameId": imported.Game.ID, "nodeId": "var:2"})
	if state.Snapshot.NodeID != "var:2" || state.Snapshot.BranchMode != "variation" || state.Current.NodeID != "var:2" {
		t.Fatalf("state = %#v", state)
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
		Root: game.RootAnalysis{Winrate: 0.42, ScoreLead: 2.1, Visits: 500},
		Candidates: []game.CandidateRaw{
			{Move: "Q16", Order: 0, Visits: 500, Winrate: 0.42, ScoreLead: 2.1},
			{Move: "D4", Order: 1, Visits: 50, Winrate: 0.30, ScoreLead: -10},
		},
	})
	ws.SetAnalysis(gameID, "main:1", game.AnalysisResult{
		Root: game.RootAnalysis{Winrate: 0.56, ScoreLead: -1.4, Visits: 500},
		Candidates: []game.CandidateRaw{
			{Move: "D4", Order: 0, Visits: 500, Winrate: 0.56, ScoreLead: -1.4},
		},
	})

	state := callWorkspaceState(t, handler, ctx, "secret")
	if state.GameID != gameID {
		t.Fatalf("selected game = %q, want %q", state.GameID, gameID)
	}
	if state.Snapshot.MoveNumber != 1 {
		t.Fatalf("snapshot = %#v", state.Snapshot)
	}
	if state.Current.NodeID != "main:1" || state.Timeline.RootWinrates[1] == nil || *state.Timeline.RootWinrates[1] != 0.56 {
		t.Fatalf("state analysis = current %#v timeline %#v", state.Current, state.Timeline)
	}
	if len(state.Timeline.NodeIDs) != 3 || state.Timeline.NodeIDs[0] != "main:0" || state.Timeline.NodeIDs[1] != "main:1" {
		t.Fatalf("timeline = %#v", state.Timeline)
	}
	if len(state.BadMoves.PointLosses) != 1 || state.BadMoves.MoveNumbers[0] != 1 || state.BadMoves.Moves[0] != "Q16" || state.BadMoves.Colors[0] != game.Black || state.BadMoves.PointLosses[0] != 3.5 {
		t.Fatalf("bad moves = %#v", state.BadMoves)
	}
}

func TestWorkspaceStateReturnsColumnarPayload(t *testing.T) {
	h, token := newTestHandler(t)
	imported := callResult[ImportResult](t, h, token, "game.importSgf", map[string]any{
		"displayName": "Demo",
		"sgfText":     "(;GM[1]FF[4]SZ[19]KM[7.5]RU[chinese];B[pd])",
	})
	state := callResult[StatePayload](t, h, token, "workspace.state", map[string]any{})
	if state.Type != "state" || state.Schema != 1 || state.GameID != imported.Game.ID {
		t.Fatalf("state header = %#v", state)
	}
	if len(state.Timeline.NodeIDs) != 2 || state.Timeline.NodeIDs[1] != "main:1" {
		t.Fatalf("timeline = %#v", state.Timeline)
	}
	if state.Current.NodeID != "main:0" {
		t.Fatalf("current node = %q", state.Current.NodeID)
	}
}

func TestAnalysisUpdateNotificationContainsFullState(t *testing.T) {
	h, token := newTestHandler(t)
	imported := callResult[ImportResult](t, h, token, "game.importSgf", map[string]any{
		"displayName": "Demo",
		"sgfText":     "(;GM[1]FF[4]SZ[19]KM[7.5]RU[chinese];B[pd])",
	})
	h.workspaces.ForToken(token).SetAnalysis(imported.Game.ID, "main:0", game.AnalysisResult{
		Root: game.RootAnalysis{Winrate: 0.51, ScoreLead: 1.0, Visits: 10},
	})
	state := callResult[StatePayload](t, h, token, "workspace.state", map[string]any{})
	if state.Timeline.RootWinrates[0] == nil || *state.Timeline.RootWinrates[0] != 0.51 {
		t.Fatalf("payload = %#v", state.Timeline.RootWinrates)
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
		Method string       `json:"method"`
		Params StatePayload `json:"params"`
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
	if notification.Params.GameID != gameID || len(notification.Params.Timeline.NodeIDs) == 0 || notification.Params.Snapshot.NodeID == "" {
		t.Fatalf("notification params = %#v", notification.Params)
	}
}

func callWorkspaceState(t *testing.T, handler *Handler, ctx context.Context, token string) StatePayload {
	t.Helper()
	result, err := handler.Call(ctx, token, "workspace.state", nil)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	var state StatePayload
	if err := json.Unmarshal(raw, &state); err != nil {
		t.Fatal(err)
	}
	return state
}

func newTestHandler(t *testing.T) (*Handler, string) {
	t.Helper()
	ctx := context.Background()
	dir := t.TempDir()
	repo, err := store.Open(ctx, filepath.Join(dir, "jcgo.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = repo.Close() })
	return NewHandler(repo, store.NewFileStore(filepath.Join(dir, "games")), NewWorkspaceStore(), nil), "secret"
}

func callResult[T any](t *testing.T, handler *Handler, token string, method string, params map[string]any) T {
	t.Helper()
	raw, err := json.Marshal(params)
	if err != nil {
		t.Fatal(err)
	}
	result, err := handler.Call(context.Background(), token, method, raw)
	if err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	var out T
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func waitForAnalysisFile(t *testing.T, files store.FileStore, sgfFilename string, wantNodes int) {
	t.Helper()
	deadline := time.After(time.Second)
	for {
		raw, err := files.ReadAnalysis(sgfFilename)
		if err == nil {
			var decoded struct {
				Nodes map[string]json.RawMessage `json:"nodes"`
			}
			if err := json.Unmarshal(raw, &decoded); err != nil {
				t.Fatal(err)
			}
			if len(decoded.Nodes) == wantNodes {
				return
			}
		}
		select {
		case <-deadline:
			t.Fatalf("analysis file did not reach %d nodes", wantNodes)
		default:
			time.Sleep(10 * time.Millisecond)
		}
	}
}

func nodeIDs(nodes []NodeInput) []string {
	ids := make([]string, 0, len(nodes))
	for _, node := range nodes {
		ids = append(ids, node.NodeID)
	}
	return ids
}

type recordingAnalysisController struct {
	started   []StartInput
	restarted []StartInput
	stopped   []string
}

func (r *recordingAnalysisController) StartGame(input StartInput) {
	r.started = append(r.started, input)
}

func (r *recordingAnalysisController) StopGame(token, gameID string) {
	r.stopped = append(r.stopped, token+"\x00"+gameID)
}

func (r *recordingAnalysisController) RestartGame(input StartInput) {
	r.restarted = append(r.restarted, input)
}

func (r *recordingAnalysisController) AnalyzeNow(StartInput) {}

func (r *recordingAnalysisController) Subscribe(Subscriber) func() {
	return func() {}
}

func (r *recordingAnalysisController) Status() katago.Status {
	return katago.Status{Available: true}
}
