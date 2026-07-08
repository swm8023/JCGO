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
	"jcgo/internal/worker"
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

	result, err := handler.Call(ctx, "secret", "game.importSgf", json.RawMessage(`{"displayName":"Demo","originalFilename":"demo.sgf","sgfText":"(;GM[1]FF[4]SZ[19]PB[Lee]PW[Cho]RE[B+R]DT[2026-06-24];B[pd])"}`))
	if err != nil {
		t.Fatal(err)
	}
	imported := result.(ImportResult)
	if imported.Game.DisplayName != "Demo" || imported.Game.Result != "B+R" || imported.Snapshot.MoveNumber != 0 {
		t.Fatalf("imported = %#v", imported)
	}
	if imported.Game.GameDate != "2026-06-24" {
		t.Fatalf("game date = %q", imported.Game.GameDate)
	}
	if imported.Game.BlackName != "Lee" || imported.Game.WhiteName != "Cho" {
		t.Fatalf("player names = %#v", imported.Game)
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
	if listResult.(ListResult).Games[0].GameDate != "2026-06-24" || listResult.(ListResult).Games[0].BlackName != "Lee" || listResult.(ListResult).Games[0].WhiteName != "Cho" || listResult.(ListResult).Games[0].AnalysisStatus != string(AnalysisComplete) {
		t.Fatalf("list metadata = %#v", listResult)
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

func TestGameListBackfillsMissingGameDateFromStoredSGF(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	repo, err := store.Open(ctx, filepath.Join(dir, "jcgo.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	files := store.NewFileStore(filepath.Join(dir, "games"))
	record, err := repo.CreateGame(ctx, store.CreateGameInput{
		DisplayName: "Legacy",
		Result:      "W+R",
		SGFFilename: "legacy.sgf",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := files.WriteSGF(record.SGFFilename, "(;GM[1]FF[4]SZ[19]DT[2026-06-26]RE[W+R];B[pd])"); err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(repo, files, NewWorkspaceStore(), nil)

	listResult, err := handler.Call(ctx, "secret", "game.list", nil)
	if err != nil {
		t.Fatal(err)
	}
	if listResult.(ListResult).Games[0].GameDate != "2026-06-26" {
		t.Fatalf("list game date = %#v", listResult)
	}
	stored, err := repo.GetGame(ctx, record.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.GameDate != "2026-06-26" {
		t.Fatalf("stored game date = %q", stored.GameDate)
	}
}

func TestGameListBackfillsPlayerNamesFromStoredSGF(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	repo, err := store.Open(ctx, filepath.Join(dir, "jcgo.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	files := store.NewFileStore(filepath.Join(dir, "games"))
	record, err := repo.CreateGame(ctx, store.CreateGameInput{
		DisplayName: "Legacy",
		Result:      "B+R",
		SGFFilename: "legacy.sgf",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := files.WriteSGF(record.SGFFilename, "(;GM[1]FF[4]SZ[19]PB[Lee]PW[Cho]RE[B+R];B[pd])"); err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(repo, files, NewWorkspaceStore(), nil)

	listResult, err := handler.Call(ctx, "secret", "game.list", nil)
	if err != nil {
		t.Fatal(err)
	}
	listed := listResult.(ListResult).Games[0]
	if listed.BlackName != "Lee" || listed.WhiteName != "Cho" {
		t.Fatalf("listed names = %#v", listed)
	}
	stored, err := repo.GetGame(ctx, record.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.BlackName != "Lee" || stored.WhiteName != "Cho" {
		t.Fatalf("stored names = %#v", stored)
	}
}

func TestGameListAnalysisStatusComesFromAnalysisFileEvenWhenWorkspaceStopped(t *testing.T) {
	h, token := newTestHandler(t)
	imported := callResult[ImportResult](t, h, token, "game.importSgf", map[string]any{
		"displayName": "Demo",
		"sgfText":     "(;GM[1]FF[4]SZ[19];B[pd])",
	})
	if _, err := h.files.WriteAnalysis(imported.Game.SGFFilename, []byte(`not-json-but-present`)); err != nil {
		t.Fatal(err)
	}
	h.workspaces.ForToken(token).MarkAnalysisStopped(imported.Game.ID)

	listResult := callResult[ListResult](t, h, token, "game.list", nil)
	if got := listResult.Games[0].AnalysisStatus; got != string(AnalysisComplete) {
		t.Fatalf("analysis status = %q, want %q from analysis filename", got, AnalysisComplete)
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

type fakeYuanluoboBackend struct {
	status  YuanluoboStatusResult
	players []YuanluoboPlayer
	records YuanluoboRecordList
	sgf     string
	name    string
	cleared bool
}

func (f *fakeYuanluoboBackend) LoginStart(ctx context.Context) (YuanluoboQRCode, error) {
	return YuanluoboQRCode{Key: "key-1", Image: "image-1"}, nil
}

func (f *fakeYuanluoboBackend) LoginPoll(ctx context.Context, key string) (YuanluoboLoginPoll, error) {
	return YuanluoboLoginPoll{Status: YuanluoboQRLogined, Desc: "已登录"}, nil
}

func (f *fakeYuanluoboBackend) Status(ctx context.Context) (YuanluoboStatusResult, error) {
	return f.status, nil
}

func (f *fakeYuanluoboBackend) Logout(ctx context.Context) error {
	f.cleared = true
	return nil
}

func (f *fakeYuanluoboBackend) Players(ctx context.Context) ([]YuanluoboPlayer, error) {
	return f.players, nil
}

func (f *fakeYuanluoboBackend) Records(ctx context.Context, in YuanluoboRecordListRequest) (YuanluoboRecordList, error) {
	f.records.Page = in.Page
	f.records.Size = 10
	return f.records, nil
}

func (f *fakeYuanluoboBackend) DetailSGF(ctx context.Context, sessionID string) (string, string, error) {
	return f.sgf, f.name, nil
}

func (f *fakeYuanluoboBackend) ClearAuth(ctx context.Context) error {
	f.cleared = true
	return nil
}

func TestYuanluoboRecordsMarksImportedGames(t *testing.T) {
	h, token := newTestHandler(t)
	fake := &fakeYuanluoboBackend{
		records: YuanluoboRecordList{
			Total: 2, Page: 1, Size: 10, PageTotal: 1,
			List: []YuanluoboRemoteRecord{
				{SessionID: "session-imported", GameMode: 1, StartTime: 1783500000, BlackPlayerName: "A", WhitePlayerName: "B", Status: 2, WinPieces: 20.25, BlackNumber: 190, WhiteNumber: 150, TotalRound: 128},
				{SessionID: "session-new", GameMode: 15, StartTime: 1783400000, BlackPlayerName: "C", WhitePlayerName: "D", Status: 1, WinPieces: 0, TotalRound: 88},
			},
		},
	}
	h.yuanluobo = fake
	imported, err := h.repo.CreateGame(context.Background(), store.CreateGameInput{
		DisplayName:    "Imported",
		Result:         "B+R",
		SourcePlatform: yuanluoboSourcePlatform,
		SourceID:       "session-imported",
	})
	if err != nil {
		t.Fatal(err)
	}

	out := callResult[YuanluoboRecordsResult](t, h, token, "yuanluobo.records", map[string]any{
		"playerId": "player-1",
		"gameMode": 1,
		"page":     1,
	})
	if len(out.Records) != 2 {
		t.Fatalf("records = %#v", out)
	}
	if !out.Records[0].Imported || out.Records[0].GameID != imported.ID {
		t.Fatalf("imported marker = %#v", out.Records[0])
	}
	if out.Records[0].Result != "B+40.50" || out.Records[0].ResultLabel != "黑胜 40.5目" || out.Records[0].ResultWinner != "B" || out.Records[0].TotalRound != 128 {
		t.Fatalf("imported result metadata = %#v", out.Records[0])
	}
	if out.Records[1].Imported || out.Records[1].GameID != "" {
		t.Fatalf("new marker = %#v", out.Records[1])
	}
	if out.Records[1].Result != "W+R" || out.Records[1].ResultLabel != "白中盘胜" || out.Records[1].ResultWinner != "W" || out.Records[1].TotalRound != 88 {
		t.Fatalf("new result metadata = %#v", out.Records[1])
	}
}

func TestYuanluoboImportRecordCreatesAndDeduplicates(t *testing.T) {
	h, token := newTestHandler(t)
	h.yuanluobo = &fakeYuanluoboBackend{
		sgf:  "(;GM[1]FF[4]SZ[19]RE[B+R]DT[2026-07-08]PB[Black]PW[White];B[pd])",
		name: "Black vs White",
	}

	first := callResult[ImportResult](t, h, token, "yuanluobo.importRecord", map[string]any{"sessionId": "session-1"})
	second := callResult[ImportResult](t, h, token, "yuanluobo.importRecord", map[string]any{"sessionId": "session-1"})
	if first.Game.ID != second.Game.ID {
		t.Fatalf("dedupe failed: %s vs %s", first.Game.ID, second.Game.ID)
	}
	stored, err := h.repo.GetGame(context.Background(), first.Game.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.SourcePlatform != yuanluoboSourcePlatform || stored.SourceID != "session-1" {
		t.Fatalf("stored source = %#v", stored)
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
		if payload.Current.NodeID == "var:1" && payload.Variation != nil && len(payload.Variation.Timeline.RootVisits) == 1 && payload.Variation.Timeline.RootVisits[0] != nil {
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

func TestBadMovePromptDescribesPositionBeforeBadMove(t *testing.T) {
	h, token := newTestHandler(t)
	imported := callResult[ImportResult](t, h, token, "game.importSgf", map[string]any{
		"displayName": "Demo",
		"sgfText":     "(;GM[1]FF[4]SZ[19];B[pd];W[dd];B[qp])",
	})
	gameID := imported.Game.ID
	ws := h.workspaces.ForToken(token)
	ws.SetAnalysis(gameID, "main:2", game.AnalysisResult{
		Root: game.RootAnalysis{ScoreLead: 2.0, Visits: 500},
		Candidates: []game.CandidateRaw{
			{Move: "D4", Order: 0, Visits: 500, ScoreLead: 2.5},
			{Move: "R4", Order: 1, Visits: 100, ScoreLead: -1.5},
		},
	})
	ws.SetAnalysis(gameID, "main:3", game.AnalysisResult{
		Root: game.RootAnalysis{ScoreLead: -1.5, Visits: 500},
	})

	result := callResult[struct {
		Prompt string `json:"prompt"`
	}](t, h, token, "analysis.badMovePrompt", map[string]any{"gameId": gameID, "nodeId": "main:3"})
	want := "当前棋局黑棋占 Q16，白棋占 D16，现在轮到黑棋，走在 R4，这一步AI认为不好，损失3.5目，AI认为最佳点在 D4。帮我分析下为什么不好，原因是什么，以及为什么推荐下在D4"
	if result.Prompt != want {
		t.Fatalf("prompt = %q, want %q", result.Prompt, want)
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

func TestWorkspaceStateIncludesWorkerStatus(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	repo, err := store.Open(ctx, filepath.Join(dir, "jcgo.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	status := worker.StatusSnapshot{
		Connected: 1,
		Available: 1,
		Busy:      0,
		Local:     katago.Status{Available: true},
		Workers: []worker.RuntimeStatus{{
			ID:        "worker-1",
			Name:      "gpu-worker",
			Platform:  "windows/amd64",
			Available: true,
		}},
	}
	handler := NewHandlerWithOptions(repo, store.NewFileStore(filepath.Join(dir, "games")), NewWorkspaceStore(), nil, HandlerOptions{
		WorkerStatusProvider: fakeWorkerStatusProvider{status: status},
	})

	state := callResult[struct {
		WorkerStatus worker.StatusSnapshot `json:"workerStatus"`
	}](t, handler, "secret", "workspace.state", nil)

	if state.WorkerStatus.Connected != 1 || state.WorkerStatus.Available != 1 || len(state.WorkerStatus.Workers) != 1 {
		t.Fatalf("worker status = %#v", state.WorkerStatus)
	}
	if state.WorkerStatus.Workers[0].Name != "gpu-worker" {
		t.Fatalf("worker details = %#v", state.WorkerStatus.Workers)
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

type fakeWorkerStatusProvider struct {
	status worker.StatusSnapshot
}

func (f fakeWorkerStatusProvider) StatusSnapshot() worker.StatusSnapshot {
	return f.status
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
