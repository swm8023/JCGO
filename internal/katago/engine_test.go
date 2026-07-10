package katago

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

func TestMain(m *testing.M) {
	if os.Getenv("JCGO_TEST_KATAGO_HELPER") == "exit-with-stderr" {
		_, _ = os.Stderr.WriteString("katago helper: missing runtime dependency\n")
		os.Exit(2)
	}
	if os.Getenv("JCGO_TEST_KATAGO_HELPER") == "hang-analysis" {
		scanner := bufio.NewScanner(os.Stdin)
		for scanner.Scan() {
		}
		select {}
	}
	os.Exit(m.Run())
}

func TestBuildQueryUsesBlackPerspectiveInitialPlayerAndInitialStones(t *testing.T) {
	query := BuildQuery(BuildInput{
		ID:            "q-1",
		Rules:         "chinese",
		Komi:          7.5,
		MaxVisits:     500,
		InitialStones: []Stone{{Player: "B", Move: "D16"}},
		InitialPlayer: "W",
		Moves:         []Move{{Player: "B", Move: "Q16"}},
		AnalyzeTurn:   1,
	})
	if query.Rules != "chinese" || query.Komi != 7.5 || query.MaxVisits != 500 {
		t.Fatalf("query = %#v", query)
	}
	if len(query.InitialStones) != 1 || query.InitialStones[0][1] != "D16" {
		t.Fatalf("initial stones = %#v", query.InitialStones)
	}
	if len(query.Moves) != 1 || query.Moves[0][1] != "Q16" {
		t.Fatalf("moves = %#v", query.Moves)
	}
	if !query.IncludeOwnership || !query.IncludePolicy || query.IncludeMovesOwnership || query.InitialPlayer != "W" || query.BoardXSize != 19 || query.BoardYSize != 19 {
		t.Fatalf("query flags = %#v", query)
	}
	if query.ReportDuringSearchEvery != 1 {
		t.Fatalf("ReportDuringSearchEvery = %v, want 1", query.ReportDuringSearchEvery)
	}
	raw, err := json.Marshal(query)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), `"initialStones":null`) || strings.Contains(string(raw), `"moves":null`) {
		t.Fatalf("query JSON contains null arrays: %s", raw)
	}
}

func TestBuildQueryRequestsOwnershipAndPolicy(t *testing.T) {
	query := BuildQuery(BuildInput{
		ID:          "main:0",
		Rules:       "chinese",
		Komi:        7.5,
		MaxVisits:   500,
		AnalyzeTurn: 0,
	})
	if !query.IncludeOwnership {
		t.Fatal("IncludeOwnership = false")
	}
	if !query.IncludePolicy {
		t.Fatal("IncludePolicy = false")
	}
	if query.IncludeMovesOwnership {
		t.Fatal("IncludeMovesOwnership = true")
	}
}

func TestBuildQueryEncodesEmptyListsAsArrays(t *testing.T) {
	query := BuildQuery(BuildInput{
		ID:          "root",
		Rules:       "chinese",
		Komi:        7.5,
		MaxVisits:   500,
		AnalyzeTurn: 0,
	})
	raw, err := json.Marshal(query)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), `"initialStones":null`) || strings.Contains(string(raw), `"moves":null`) {
		t.Fatalf("query JSON contains null arrays: %s", raw)
	}
}

func TestResultParsesOwnership(t *testing.T) {
	data := []byte(`{"id":"main:0","rootInfo":{"visits":10,"winrate":0.5,"scoreLead":1.2},"moveInfos":[],"ownership":[1,-1,0.5],"policy":[0.1,0.9]}`)
	var result Result
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Ownership) != 3 || result.Ownership[0] != 1 || result.Ownership[1] != -1 || result.Ownership[2] != 0.5 {
		t.Fatalf("ownership = %#v", result.Ownership)
	}
	if len(result.Policy) != 2 || result.Policy[0] != 0.1 || result.Policy[1] != 0.9 {
		t.Fatalf("policy = %#v", result.Policy)
	}
}

func TestUnavailableEngineReturnsError(t *testing.T) {
	engine := NewUnavailable("missing katago")
	if engine.Available() {
		t.Fatal("Available = true")
	}
	if engine.Status().Error != "missing katago" {
		t.Fatalf("status = %#v", engine.Status())
	}
	_, err := engine.Analyze(context.Background(), Query{ID: "q-1"})
	if err == nil {
		t.Fatal("Analyze returned nil error")
	}
}

func TestLocalEngineReportsKatagoStderrAfterProcessExit(t *testing.T) {
	t.Setenv("JCGO_TEST_KATAGO_HELPER", "exit-with-stderr")
	engine, err := StartLocal(context.Background(), os.Args[0], "model.bin.gz", "analysis.cfg")
	if err != nil {
		t.Fatalf("StartLocal returned error: %v", err)
	}
	t.Cleanup(func() {
		_ = engine.Close()
	})

	time.Sleep(50 * time.Millisecond)
	if engine.Available() {
		t.Fatal("Available = true after KataGo process exited")
	}
	status := engine.Status()
	if status.Available {
		t.Fatalf("status = %#v, want unavailable", status)
	}
	if !strings.Contains(status.Error, "missing runtime dependency") {
		t.Fatalf("status error = %q, want stderr details", status.Error)
	}

	_, err = engine.Analyze(context.Background(), Query{ID: "q-1"})
	if err == nil {
		t.Fatal("Analyze returned nil error")
	}
	if !strings.Contains(err.Error(), "katago exited") {
		t.Fatalf("error = %q, want katago exited context", err)
	}
	if !strings.Contains(err.Error(), "missing runtime dependency") {
		t.Fatalf("error = %q, want stderr details", err)
	}
}

func TestLocalEngineAnalyzeReturnsWhenContextIsCancelled(t *testing.T) {
	t.Setenv("JCGO_TEST_KATAGO_HELPER", "hang-analysis")
	engine, err := StartLocal(context.Background(), os.Args[0], "model.bin.gz", "analysis.cfg")
	if err != nil {
		t.Fatalf("StartLocal returned error: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := engine.Analyze(ctx, Query{ID: "q-cancel"})
		done <- err
	}()
	time.Sleep(50 * time.Millisecond)
	cancel()

	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("err = %v", err)
		}
	case <-time.After(200 * time.Millisecond):
		_ = engine.Close()
		t.Fatal("Analyze did not return after context cancellation")
	}
}
