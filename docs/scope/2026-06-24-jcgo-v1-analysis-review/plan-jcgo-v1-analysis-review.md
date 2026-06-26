# JCGO v1 Analysis Review Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the current JCGO v1 implementation to the confirmed KaTrain-aligned analysis state, ownership rendering, variation behavior, and responsive board UI described in the refreshed spec.

**Architecture:** The Go backend remains the game-rule and analysis authority, but its workspace cache changes from per-snapshot object results to per-game main/variation analysis stores that can emit columnar state payloads. The React frontend consumes those columnar payloads, derives display-only metrics locally, and renders board overlays in fixed layers with local toggle preferences.

**Tech Stack:** Go, Gorilla WebSocket, KataGo Analysis Engine JSON, React, TypeScript, Vite, Vitest, Testing Library, Playwright.

---

## Reference Inputs

- Product spec: `docs/scope/2026-06-24-jcgo-v1-analysis-review/spec-jcgo-v1-analysis-review.md`
- Existing implementation entry points:
  - `internal/app/workspace.go`
  - `internal/app/handlers.go`
  - `internal/app/scheduler.go`
  - `internal/game/analysis.go`
  - `internal/game/game.go`
  - `internal/game/sgf.go`
  - `internal/game/types.go`
  - `internal/katago/query.go`
  - `internal/katago/engine.go`
  - `web/src/api/types.ts`
  - `web/src/App.tsx`
  - `web/src/components/Board.tsx`
  - `web/src/components/AnalysisCharts.tsx`
  - `web/src/components/GameSidebar.tsx`
- KaTrain reference source:
  - `D:\Code\katrain\katrain\core\game_node.py`
  - `D:\Code\katrain\katrain\gui\badukpan.py`
  - `D:\Code\katrain\katrain\gui\theme.py`
  - `D:\Code\katrain\katrain\config.json`

## Planned File Structure

Backend additions and refactors:

- `internal/game/types.go` - SGF/game metadata, raw analysis DTOs, columnar payload DTOs.
- `internal/game/sgf.go` - parse `PB`, `PW`, `RE`, `KM`, `RU`.
- `internal/game/game.go` - expose game metadata and variation timeline inputs.
- `internal/game/analysis.go` - keep KaTrain thresholds, raw candidate normalization, played point loss helpers, q8 ownership encoding helpers.
- `internal/katago/query.go` - request ownership and disable policy.
- `internal/katago/engine.go` - parse `ownership`.
- `internal/app/workspace.go` - replace flat `analysis map[string]AnalysisResult` with per-game `GameState`.
- `internal/app/state_payload.go` - build columnar state payloads from `GameState`.
- `internal/app/handlers.go` - return `StatePayload` for workspace/state-changing calls and push full state notifications.
- `internal/app/scheduler.go` - publish raw ownership-aware analysis results.

Frontend additions and refactors:

- `web/src/api/types.ts` - mirror columnar payloads and raw candidate data.
- `web/src/state/selectors.ts` - convert columnar state into render data and derive candidate display metrics.
- `web/src/board/coordinates.ts` - GTP/board coordinate helpers.
- `web/src/board/katainStyle.ts` - KaTrain thresholds, colors, candidate formatting, ownership decoding.
- `web/src/components/Board.tsx` - fixed overlay layer rendering.
- `web/src/components/BoardInfo.tsx` - responsive black/white/komi/rules strip.
- `web/src/components/OverlayToggles.tsx` - left toolbar toggles with localStorage persistence.
- `web/src/components/AnalysisCharts.tsx` - consume main or variation columnar timeline.
- `web/src/App.tsx` - state orchestration for columnar payloads, PV/try-mode mutual exclusion, and current detail.
- `web/src/styles.css` - board layer styling, responsive board info, toolbar toggles.

## Task 1: SGF Metadata and Game Snapshot Inputs

**Files:**
- Modify: `internal/game/sgf.go`
- Modify: `internal/game/types.go`
- Modify: `internal/game/game.go`
- Modify: `internal/game/sgf_test.go`
- Modify: `internal/game/game_test.go`

- [ ] **Step 1: Write failing SGF metadata test**

Add this test to `internal/game/sgf_test.go`:

```go
func TestParseSGFReadsPlayerNamesResultRulesAndKomi(t *testing.T) {
	doc, err := ParseSGF(`(;GM[1]FF[4]SZ[19]KM[6.5]RU[japanese]PB[Lee]PW[Cho]RE[W+1.5];B[pd];W[dd])`)
	if err != nil {
		t.Fatal(err)
	}
	if doc.BlackName != "Lee" || doc.WhiteName != "Cho" {
		t.Fatalf("players = %q/%q", doc.BlackName, doc.WhiteName)
	}
	if doc.Result != "W+1.5" || doc.Rules != "japanese" || doc.Komi != 6.5 {
		t.Fatalf("metadata = result %q rules %q komi %.1f", doc.Result, doc.Rules, doc.Komi)
	}
}
```

- [ ] **Step 2: Write failing snapshot metadata test**

Add this test to `internal/game/game_test.go`:

```go
func TestSnapshotIncludesGameInfo(t *testing.T) {
	doc, err := ParseSGF(`(;GM[1]FF[4]SZ[19]KM[7.5]RU[chinese]PB[Black A]PW[White B]RE[B+R];B[pd])`)
	if err != nil {
		t.Fatal(err)
	}
	g, err := NewFromSGF("game-1", doc)
	if err != nil {
		t.Fatal(err)
	}
	snap := g.CurrentSnapshot()
	if snap.BlackName != "Black A" || snap.WhiteName != "White B" {
		t.Fatalf("snapshot players = %q/%q", snap.BlackName, snap.WhiteName)
	}
	if snap.Result != "B+R" || snap.Komi != 7.5 || snap.Rules != "chinese" {
		t.Fatalf("snapshot metadata = %#v", snap)
	}
}
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```powershell
go test .\internal\game -run "TestParseSGFReadsPlayerNamesResultRulesAndKomi|TestSnapshotIncludesGameInfo" -count=1
```

Expected: FAIL because `SGFDocument.BlackName`, `SGFDocument.WhiteName`, `Snapshot.BlackName`, `Snapshot.WhiteName`, and `Snapshot.Result` do not exist.

- [ ] **Step 4: Add metadata fields**

Modify `internal/game/types.go`:

```go
type Snapshot struct {
	GameID        string          `json:"gameId"`
	NodeID        string          `json:"nodeId"`
	MoveNumber    int             `json:"moveNumber"`
	TotalMoves    int             `json:"totalMoves"`
	BranchMode    string          `json:"branchMode"`
	Stones        []Stone         `json:"stones"`
	LastMove      *MoveView       `json:"lastMove,omitempty"`
	Children      []MoveView      `json:"children"`
	ToPlay        Color           `json:"toPlay"`
	Rules         string          `json:"rules"`
	Komi          float64         `json:"komi"`
	BlackName     string          `json:"blackName"`
	WhiteName     string          `json:"whiteName"`
	Result        string          `json:"result"`
	Captures      map[Color]int   `json:"captures"`
	GameEnded     bool            `json:"gameEnded"`
	CanPrevious   bool            `json:"canPrevious"`
	CanNext       bool            `json:"canNext"`
	CanBackToMain bool            `json:"canBackToMain"`
}
```

Modify `internal/game/sgf.go`:

```go
type SGFDocument struct {
	BoardSize     int
	Rules         string
	Komi          float64
	Result        string
	BlackName     string
	WhiteName     string
	InitialStones []SetupStone
	Mainline      []Move
}
```

In `ParseSGF`, set metadata after `root := nodes[0]`:

```go
doc := SGFDocument{
	BoardSize: 19,
	Rules:     "chinese",
	Komi:      7.5,
	Result:    first(root["RE"]),
	BlackName: first(root["PB"]),
	WhiteName: first(root["PW"]),
}
```

- [ ] **Step 5: Store metadata on `Game` and snapshot**

Modify `internal/game/game.go`:

```go
type Game struct {
	id               string
	rules            string
	komi             float64
	blackName        string
	whiteName        string
	result           string
	mainline         []node
	variations       map[string]node
	currentID        string
	variationCounter int
}
```

In `NewFromSGF`, after `g := NewEmpty(id, doc.Rules, doc.Komi)`:

```go
g.blackName = doc.BlackName
g.whiteName = doc.WhiteName
g.result = doc.Result
```

In `NewEmpty`, initialize fallback names:

```go
blackName:  "黑",
whiteName:  "白",
```

In `snapshot`, add:

```go
BlackName: g.blackName,
WhiteName: g.whiteName,
Result:    g.result,
```

- [ ] **Step 6: Run tests**

Run:

```powershell
go test .\internal\game -count=1
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add internal/game
git commit -m "feat: expose sgf game metadata"
```

## Task 2: KataGo Ownership Parsing and q8 Encoding

**Files:**
- Modify: `internal/katago/query.go`
- Modify: `internal/katago/engine.go`
- Modify: `internal/katago/engine_test.go`
- Modify: `internal/game/analysis.go`
- Modify: `internal/game/analysis_test.go`

- [ ] **Step 1: Write failing query test**

Modify or add this test in `internal/katago/engine_test.go`:

```go
func TestBuildQueryRequestsOwnershipWithoutPolicy(t *testing.T) {
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
	if query.IncludePolicy {
		t.Fatal("IncludePolicy = true")
	}
	if query.IncludeMovesOwnership {
		t.Fatal("IncludeMovesOwnership = true")
	}
}
```

- [ ] **Step 2: Write failing ownership JSON parse test**

Add this test to `internal/katago/engine_test.go`:

```go
func TestResultParsesOwnership(t *testing.T) {
	data := []byte(`{"id":"main:0","rootInfo":{"visits":10,"winrate":0.5,"scoreLead":1.2},"moveInfos":[],"ownership":[1,-1,0.5]}`)
	var result Result
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Ownership) != 3 || result.Ownership[0] != 1 || result.Ownership[1] != -1 || result.Ownership[2] != 0.5 {
		t.Fatalf("ownership = %#v", result.Ownership)
	}
}
```

If `encoding/json` is not imported in the test file, add it.

- [ ] **Step 3: Write failing q8 tests**

Add this test to `internal/game/analysis_test.go`:

```go
func TestEncodeOwnershipQ8(t *testing.T) {
	encoded := EncodeOwnershipQ8([]float64{-1, -0.5, 0, 0.5, 1})
	want := []byte{129, 193, 0, 63, 127}
	if !bytes.Equal(encoded, want) {
		t.Fatalf("encoded = %v, want %v", encoded, want)
	}
	decoded := DecodeOwnershipQ8(encoded)
	if len(decoded) != 5 {
		t.Fatalf("decoded length = %d", len(decoded))
	}
	if decoded[0] != -1 || decoded[2] != 0 || decoded[4] != 1 {
		t.Fatalf("decoded edge values = %v", decoded)
	}
}
```

Add `bytes` to the test imports.

- [ ] **Step 4: Run tests to verify failure**

Run:

```powershell
go test .\internal\katago .\internal\game -run "Ownership|BuildQueryRequestsOwnershipWithoutPolicy" -count=1
```

Expected: FAIL because `Result.Ownership`, `EncodeOwnershipQ8`, and `DecodeOwnershipQ8` do not exist, and query flags are not correct.

- [ ] **Step 5: Update KataGo query and result structs**

Modify `internal/katago/engine.go`:

```go
type Result struct {
	ID             string     `json:"id"`
	RootInfo       RootInfo   `json:"rootInfo"`
	MoveInfos      []MoveInfo `json:"moveInfos"`
	Ownership      []float64  `json:"ownership,omitempty"`
	IsDuringSearch bool       `json:"isDuringSearch,omitempty"`
	Error          string     `json:"error,omitempty"`
}
```

Modify `internal/katago/query.go` in `BuildQuery`:

```go
IncludeOwnership:        true,
IncludeMovesOwnership:   false,
IncludePolicy:           false,
```

- [ ] **Step 6: Add q8 ownership helpers**

Add to `internal/game/analysis.go`:

```go
func EncodeOwnershipQ8(values []float64) []byte {
	encoded := make([]byte, len(values))
	for i, value := range values {
		if value > 1 {
			value = 1
		}
		if value < -1 {
			value = -1
		}
		quantized := int8(value * 127)
		encoded[i] = byte(quantized)
	}
	return encoded
}

func DecodeOwnershipQ8(values []byte) []float64 {
	decoded := make([]float64, len(values))
	for i, value := range values {
		decoded[i] = float64(int8(value)) / 127
	}
	return decoded
}
```

- [ ] **Step 7: Run tests**

Run:

```powershell
go test .\internal\katago .\internal\game -count=1
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add internal/katago internal/game
git commit -m "feat: parse katago ownership"
```

## Task 3: Raw Analysis Types and Columnar Payload DTOs

**Files:**
- Modify: `internal/game/types.go`
- Modify: `internal/game/analysis.go`
- Modify: `internal/game/analysis_test.go`

- [ ] **Step 1: Write failing raw normalization test**

Add this test to `internal/game/analysis_test.go`:

```go
func TestNormalizeAnalysisKeepsRawCandidatesAndOwnership(t *testing.T) {
	result := katago.Result{
		RootInfo:  katago.RootInfo{Visits: 100, Winrate: 0.52, ScoreLead: 1.5},
		Ownership: []float64{-1, 0, 1},
		MoveInfos: []katago.MoveInfo{
			{Move: "Q16", Order: 0, Visits: 90, Winrate: 0.53, ScoreLead: 1.8, PV: []string{"Q16", "D4"}},
		},
	}
	out := NormalizeAnalysis(Black, result)
	if out.Root.Winrate != 0.52 || out.Root.ScoreLead != 1.5 || out.Root.Visits != 100 {
		t.Fatalf("root = %#v", out.Root)
	}
	if len(out.Candidates) != 1 || out.Candidates[0].Move != "Q16" || out.Candidates[0].PV[1] != "D4" {
		t.Fatalf("candidates = %#v", out.Candidates)
	}
	if len(out.OwnershipQ8) != 3 {
		t.Fatalf("ownership q8 length = %d", len(out.OwnershipQ8))
	}
}
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
go test .\internal\game -run TestNormalizeAnalysisKeepsRawCandidatesAndOwnership -count=1
```

Expected: FAIL because `AnalysisResult.Root`, raw candidate fields, and `OwnershipQ8` do not exist.

- [ ] **Step 3: Replace derived candidate API with raw analysis types**

Modify `internal/game/types.go`:

```go
type AnalysisResult struct {
	Root        RootAnalysis   `json:"root"`
	Candidates  []CandidateRaw `json:"candidates"`
	OwnershipQ8 []byte         `json:"-"`
}

type RootAnalysis struct {
	Winrate   float64 `json:"winrate"`
	ScoreLead float64 `json:"scoreLead"`
	Visits    int     `json:"visits"`
}

type CandidateRaw struct {
	Move      string   `json:"move"`
	Order     int      `json:"order"`
	Visits    int      `json:"visits"`
	Winrate   float64  `json:"winrate"`
	ScoreLead float64  `json:"scoreLead"`
	PV        []string `json:"pv"`
}
```

Keep `BadMove` but remove `Class` from JSON-facing data after dependent tests are updated:

```go
type BadMove struct {
	NodeID     string  `json:"nodeId"`
	MoveNumber int     `json:"moveNumber"`
	Color      Color   `json:"color"`
	Move       string  `json:"move"`
	PointLoss  float64 `json:"pointLoss"`
}
```

- [ ] **Step 4: Update normalization**

Replace `NormalizeAnalysis` in `internal/game/analysis.go`:

```go
func NormalizeAnalysis(toPlay Color, result katago.Result) AnalysisResult {
	out := AnalysisResult{
		Root: RootAnalysis{
			Winrate:   result.RootInfo.Winrate,
			ScoreLead: result.RootInfo.ScoreLead,
			Visits:    result.RootInfo.Visits,
		},
		OwnershipQ8: EncodeOwnershipQ8(result.Ownership),
	}
	for _, move := range result.MoveInfos {
		out.Candidates = append(out.Candidates, CandidateRaw{
			Move:      move.Move,
			Order:     move.Order,
			Visits:    move.Visits,
			Winrate:   move.Winrate,
			ScoreLead: move.ScoreLead,
			PV:        append([]string(nil), move.PV...),
		})
	}
	sort.SliceStable(out.Candidates, func(i, j int) bool {
		return out.Candidates[i].Order < out.Candidates[j].Order
	})
	return out
}
```

If `sort` becomes unused later, keep it because this function still orders candidates by KataGo order.

- [ ] **Step 5: Update existing backend tests**

Modify tests that currently assert `PointLoss`, `RelativePointLoss`, `WinrateLoss`, `LowVisits`, `AnalysisResult.Winrate`, `AnalysisResult.ScoreLead`, and `AnalysisResult.Visits`.

Use these replacement expectations:

```go
if out.Root.ScoreLead != 5.0 {
	t.Fatalf("root score = %.1f", out.Root.ScoreLead)
}
if out.Candidates[0].Move != "Q16" || out.Candidates[0].Order != 0 {
	t.Fatalf("candidate[0] = %#v", out.Candidates[0])
}
```

- [ ] **Step 6: Run tests**

Run:

```powershell
go test .\internal\game -count=1
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add internal/game
git commit -m "refactor: store raw analysis values"
```

## Task 4: Workspace GameState Stores and State Payload Builder

**Files:**
- Modify: `internal/app/workspace.go`
- Create: `internal/app/state_payload.go`
- Modify: `internal/app/workspace_test.go`
- Create: `internal/app/state_payload_test.go`
- Modify: `internal/app/handlers_test.go`

- [ ] **Step 1: Write failing fixed timeline payload test**

Create `internal/app/state_payload_test.go`:

```go
package app

import (
	"encoding/base64"
	"testing"

	"jcgo/internal/game"
)

func TestStatePayloadUsesFixedColumnarMainTimeline(t *testing.T) {
	ws := newWorkspace()
	doc, err := game.ParseSGF(`(;GM[1]FF[4]SZ[19]KM[7.5]RU[chinese]PB[B]PW[W]RE[B+R];B[pd];W[dd])`)
	if err != nil {
		t.Fatal(err)
	}
	if err := ws.LoadGame("game-1", doc); err != nil {
		t.Fatal(err)
	}
	ws.SetAnalysis("game-1", "main:0", game.AnalysisResult{
		Root: game.RootAnalysis{Winrate: 0.52, ScoreLead: 1.4, Visits: 100},
		Candidates: []game.CandidateRaw{{Move: "Q16", Order: 0, Visits: 90, Winrate: 0.53, ScoreLead: 1.8, PV: []string{"Q16"}}},
		OwnershipQ8: []byte{1, 2, 3},
	})
	state, err := ws.StatePayload("game-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Timeline.NodeIDs) != 3 || state.Timeline.NodeIDs[2] != "main:2" {
		t.Fatalf("node ids = %#v", state.Timeline.NodeIDs)
	}
	if state.Timeline.RootWinrates[0] == nil || *state.Timeline.RootWinrates[0] != 0.52 {
		t.Fatalf("root winrate[0] = %#v", state.Timeline.RootWinrates[0])
	}
	if state.Timeline.RootWinrates[1] != nil {
		t.Fatalf("root winrate[1] = %#v", state.Timeline.RootWinrates[1])
	}
	if state.Current.NodeID != "main:0" || state.Current.Candidates.Moves[0] != "Q16" {
		t.Fatalf("current = %#v", state.Current)
	}
	if state.Current.Ownership == nil || state.Current.Ownership.Data != base64.StdEncoding.EncodeToString([]byte{1, 2, 3}) {
		t.Fatalf("ownership = %#v", state.Current.Ownership)
	}
}
```

- [ ] **Step 2: Write failing variation payload test**

Add to `internal/app/state_payload_test.go`:

```go
func TestStatePayloadIncludesVariationTimelineAndExcludesVariationBadMoves(t *testing.T) {
	ws := newWorkspace()
	doc, err := game.ParseSGF(`(;GM[1]FF[4]SZ[19]KM[7.5]RU[chinese];B[pd])`)
	if err != nil {
		t.Fatal(err)
	}
	if err := ws.LoadGame("game-1", doc); err != nil {
		t.Fatal(err)
	}
	if _, err := ws.GotoMain("game-1", 0); err != nil {
		t.Fatal(err)
	}
	snap, err := ws.Play("game-1", "D4")
	if err != nil {
		t.Fatal(err)
	}
	ws.SetAnalysis("game-1", snap.NodeID, game.AnalysisResult{Root: game.RootAnalysis{Winrate: 0.60, ScoreLead: 3.0, Visits: 50}})
	state, err := ws.StatePayload("game-1")
	if err != nil {
		t.Fatal(err)
	}
	if state.Variation == nil || state.Variation.BaseMoveNumber != 0 || state.Variation.Timeline.NodeIDs[0] != snap.NodeID {
		t.Fatalf("variation = %#v", state.Variation)
	}
	if len(state.BadMoves.PointLosses) != 0 {
		t.Fatalf("variation polluted bad moves = %#v", state.BadMoves)
	}
}
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```powershell
go test .\internal\app -run "StatePayload" -count=1
```

Expected: FAIL because `StatePayload` and columnar DTOs do not exist.

- [ ] **Step 4: Add columnar payload structs**

Create `internal/app/state_payload.go`:

```go
package app

import (
	"encoding/base64"
	"fmt"

	"jcgo/internal/game"
)

type StatePayload struct {
	Type          string           `json:"type"`
	Schema        int              `json:"schema"`
	GameID        string           `json:"gameId"`
	CurrentNodeID string           `json:"currentNodeId"`
	AnalysisState AnalysisState    `json:"analysisState"`
	Snapshot      game.Snapshot    `json:"snapshot"`
	Timeline      TimelineColumns  `json:"timeline"`
	BadMoves      BadMoveColumns   `json:"badMoves"`
	Variation     *VariationState  `json:"variation,omitempty"`
	Current       CurrentNodeState `json:"current"`
}

type TimelineColumns struct {
	NodeIDs           []string     `json:"nodeIds"`
	Moves             []*string    `json:"moves"`
	MoveColors        []*string    `json:"moveColors"`
	Passes            []bool       `json:"passes"`
	ToPlays           []string     `json:"toPlays"`
	RootWinrates      []*float64   `json:"rootWinrates"`
	RootScoreLeads    []*float64   `json:"rootScoreLeads"`
	RootVisits        []*int       `json:"rootVisits"`
	PlayedPointLosses []*float64   `json:"playedPointLosses"`
}

type BadMoveColumns struct {
	NodeIDs     []string   `json:"nodeIds"`
	MoveNumbers []int      `json:"moveNumbers"`
	Colors      []string   `json:"colors"`
	Moves       []string   `json:"moves"`
	PointLosses []float64  `json:"pointLosses"`
}

type VariationState struct {
	BaseNodeID     string          `json:"baseNodeId"`
	BaseMoveNumber int             `json:"baseMoveNumber"`
	CurrentNodeID  string          `json:"currentNodeId"`
	Timeline       TimelineColumns `json:"timeline"`
}

type CurrentNodeState struct {
	NodeID     string             `json:"nodeId"`
	Candidates CandidateColumns   `json:"candidates"`
	Ownership *EncodedOwnership  `json:"ownership,omitempty"`
}

type CandidateColumns struct {
	Moves      []string     `json:"moves"`
	Orders     []int        `json:"orders"`
	Visits     []int        `json:"visits"`
	Winrates   []float64    `json:"winrates"`
	ScoreLeads []float64    `json:"scoreLeads"`
	PVs        [][]string   `json:"pvs"`
}

type EncodedOwnership struct {
	Encoding string `json:"encoding"`
	Data     string `json:"data"`
}
```

- [ ] **Step 5: Add GameState store types**

Modify `internal/app/workspace.go` by replacing the flat maps:

```go
type Workspace struct {
	mu             sync.Mutex
	games          map[string]*GameState
	selectedGameID string
}

type GameState struct {
	Game          *game.Game
	CurrentNodeID string
	AnalysisState AnalysisState
	Main          MainAnalysisStore
	Variation     *VariationAnalysisStore
}

type MainAnalysisStore struct {
	Frames   []AnalysisFrame
	BadMoves []game.BadMove
}

type VariationAnalysisStore struct {
	BaseNodeID     string
	BaseMoveNumber int
	CurrentNodeID  string
	Frames         []AnalysisFrame
}

type AnalysisFrame struct {
	NodeID          string
	MoveNumber      int
	Move            string
	MoveColor       game.Color
	Pass            bool
	ToPlay          game.Color
	Root            *game.RootAnalysis
	Candidates      []game.CandidateRaw
	OwnershipQ8     []byte
	PlayedPointLoss *float64
}
```

Keep public method names (`LoadGame`, `SelectGame`, `GotoMain`, `Play`, `SetAnalysis`) so handlers change minimally.

- [ ] **Step 6: Implement payload building**

Add to `internal/app/state_payload.go`:

```go
func (w *Workspace) StatePayload(gameID string) (StatePayload, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	state := w.games[gameID]
	if state == nil {
		return StatePayload{}, fmt.Errorf("game %s not loaded", gameID)
	}
	snapshot := w.withAnalysisLocked(gameID, state.Game.CurrentSnapshot())
	return StatePayload{
		Type:          "state",
		Schema:        1,
		GameID:        gameID,
		CurrentNodeID: snapshot.NodeID,
		AnalysisState: w.analysisStateLocked(gameID),
		Snapshot:      snapshot,
		Timeline:      buildTimelineColumns(state.Main.Frames),
		BadMoves:      buildBadMoveColumns(state.Main.BadMoves),
		Variation:     buildVariationState(state.Variation),
		Current:       buildCurrentNodeState(snapshot.NodeID, lookupFrame(state, snapshot.NodeID)),
	}, nil
}

func buildTimelineColumns(frames []AnalysisFrame) TimelineColumns {
	out := TimelineColumns{}
	for _, frame := range frames {
		out.NodeIDs = append(out.NodeIDs, frame.NodeID)
		out.Moves = append(out.Moves, stringPtrOrNil(frame.Move))
		out.MoveColors = append(out.MoveColors, colorPtrOrNil(frame.MoveColor))
		out.Passes = append(out.Passes, frame.Pass)
		out.ToPlays = append(out.ToPlays, string(frame.ToPlay))
		if frame.Root == nil {
			out.RootWinrates = append(out.RootWinrates, nil)
			out.RootScoreLeads = append(out.RootScoreLeads, nil)
			out.RootVisits = append(out.RootVisits, nil)
		} else {
			out.RootWinrates = append(out.RootWinrates, floatPtr(frame.Root.Winrate))
			out.RootScoreLeads = append(out.RootScoreLeads, floatPtr(frame.Root.ScoreLead))
			out.RootVisits = append(out.RootVisits, intPtr(frame.Root.Visits))
		}
		out.PlayedPointLosses = append(out.PlayedPointLosses, frame.PlayedPointLoss)
	}
	return out
}
```

Implement `buildBadMoveColumns`, `buildVariationState`, `buildCurrentNodeState`, `lookupFrame`, `stringPtrOrNil`, `colorPtrOrNil`, `floatPtr`, and `intPtr` in the same file:

```go
func buildBadMoveColumns(moves []game.BadMove) BadMoveColumns {
	out := BadMoveColumns{}
	for _, move := range moves {
		out.NodeIDs = append(out.NodeIDs, move.NodeID)
		out.MoveNumbers = append(out.MoveNumbers, move.MoveNumber)
		out.Colors = append(out.Colors, string(move.Color))
		out.Moves = append(out.Moves, move.Move)
		out.PointLosses = append(out.PointLosses, move.PointLoss)
	}
	return out
}

func buildVariationState(store *VariationAnalysisStore) *VariationState {
	if store == nil {
		return nil
	}
	return &VariationState{
		BaseNodeID:     store.BaseNodeID,
		BaseMoveNumber: store.BaseMoveNumber,
		CurrentNodeID:  store.CurrentNodeID,
		Timeline:       buildTimelineColumns(store.Frames),
	}
}

func buildCurrentNodeState(nodeID string, frame *AnalysisFrame) CurrentNodeState {
	out := CurrentNodeState{NodeID: nodeID}
	if frame == nil {
		return out
	}
	for _, candidate := range frame.Candidates {
		out.Candidates.Moves = append(out.Candidates.Moves, candidate.Move)
		out.Candidates.Orders = append(out.Candidates.Orders, candidate.Order)
		out.Candidates.Visits = append(out.Candidates.Visits, candidate.Visits)
		out.Candidates.Winrates = append(out.Candidates.Winrates, candidate.Winrate)
		out.Candidates.ScoreLeads = append(out.Candidates.ScoreLeads, candidate.ScoreLead)
		out.Candidates.PVs = append(out.Candidates.PVs, append([]string(nil), candidate.PV...))
	}
	if len(frame.OwnershipQ8) > 0 {
		out.Ownership = &EncodedOwnership{Encoding: "q8-base64", Data: base64.StdEncoding.EncodeToString(frame.OwnershipQ8)}
	}
	return out
}

func stringPtrOrNil(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func colorPtrOrNil(value game.Color) *string {
	if value == "" {
		return nil
	}
	s := string(value)
	return &s
}

func floatPtr(value float64) *float64 { return &value }
func intPtr(value int) *int { return &value }
```

- [ ] **Step 7: Implement GameState mutations**

In `workspace.go`, update `LoadGame` to initialize fixed main frames:

```go
frames := make([]AnalysisFrame, 0, len(g.MainlineAnalysisInputs()))
for _, input := range g.MainlineAnalysisInputs() {
	frames = append(frames, frameFromInput(input))
}
w.games[gameID] = &GameState{
	Game:          g,
	CurrentNodeID: "main:0",
	AnalysisState: AnalysisIdle,
	Main:          MainAnalysisStore{Frames: frames},
}
```

Add:

```go
func frameFromInput(input game.AnalysisInput) AnalysisFrame {
	return AnalysisFrame{
		NodeID:     input.NodeID,
		MoveNumber: input.MoveNumber,
		Move:       input.Move,
		MoveColor:  input.MoveColor,
		Pass:       input.Move == "pass",
		ToPlay:     input.ToPlay,
	}
}
```

Update `SetAnalysis` to find the frame, set root/candidates/ownership, and call `rebuildMainBadMovesLocked` for main frames.

- [ ] **Step 8: Run app tests and fix dependent assertions**

Run:

```powershell
go test .\internal\app -count=1
```

Expected: PASS after updating tests that still expect `WorkspaceState.ChartPoints`, `WorkspaceState.BadMoves`, or `Snapshot.Analysis` as primary transport.

- [ ] **Step 9: Commit**

```powershell
git add internal/app internal/game
git commit -m "feat: add columnar workspace state"
```

## Task 5: Handlers and Scheduler Emit Full Columnar State

**Files:**
- Modify: `internal/app/handlers.go`
- Modify: `internal/app/handlers_test.go`
- Modify: `internal/app/scheduler.go`
- Modify: `internal/app/scheduler_test.go`
- Modify: `internal/server/jsonrpc.go` if notification typing needs adjustment

- [ ] **Step 1: Write failing handler state test**

Add to `internal/app/handlers_test.go`:

```go
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
```

Use existing test helpers in `handlers_test.go`; if they are named differently, adapt only the helper names and keep the assertions.

- [ ] **Step 2: Write failing notification test**

Add to `internal/app/handlers_test.go`:

```go
func TestAnalysisUpdateNotificationContainsFullState(t *testing.T) {
	h, token := newTestHandler(t)
	imported := callResult[ImportResult](t, h, token, "game.importSgf", map[string]any{
		"displayName": "Demo",
		"sgfText":     "(;GM[1]FF[4]SZ[19]KM[7.5]RU[chinese];B[pd])",
	})
	h.workspaces.ForToken(token).SetAnalysis(imported.Game.ID, "main:0", game.AnalysisResult{
		Root: game.RootAnalysis{Winrate: 0.51, ScoreLead: 1.0, Visits: 10},
	})
	state, err := h.workspaceState(context.Background(), token)
	if err != nil {
		t.Fatal(err)
	}
	payload := state.(StatePayload)
	if payload.Timeline.RootWinrates[0] == nil || *payload.Timeline.RootWinrates[0] != 0.51 {
		t.Fatalf("payload = %#v", payload.Timeline.RootWinrates)
	}
}
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```powershell
go test .\internal\app -run "ColumnarPayload|FullState|WorkspaceState" -count=1
```

Expected: FAIL because handlers still return the old `WorkspaceState`.

- [ ] **Step 4: Update handler return types**

In `internal/app/handlers.go`, change `workspaceState` to return `StatePayload` for the selected game. Use this behavior:

```go
func (h *Handler) workspaceState(ctx context.Context, token string) (any, error) {
	games, err := h.repo.ListGames(ctx)
	if err != nil {
		return nil, err
	}
	ws := h.workspaces.ForToken(token)
	selected := ws.SelectedGameID()
	if selected == "" {
		return EmptyWorkspaceState{Type: "state", Schema: 1, Games: games, AnalysisState: AnalysisIdle}, nil
	}
	payload, err := ws.StatePayload(selected)
	if err != nil {
		return nil, err
	}
	payload.Games = games
	return payload, nil
}
```

Add `Games []store.GameRecord` to `StatePayload` in `state_payload.go`:

```go
Games []store.GameRecord `json:"games"`
```

Define:

```go
type EmptyWorkspaceState struct {
	Type          string             `json:"type"`
	Schema        int                `json:"schema"`
	Games         []store.GameRecord `json:"games"`
	AnalysisState AnalysisState      `json:"analysisState"`
}
```

- [ ] **Step 5: Return full state from state-changing calls**

For `game.select`, `game.goto`, `game.play`, `game.pass`, `game.backToMain`, `game.clearVariation`, `analysis.start`, `analysis.stop`, and `analysis.restart`, keep the mutation, then return `h.workspaceState(ctx, token)` instead of `SnapshotResult`.

Example for `gotoMain`:

```go
if _, err := ws.GotoMain(in.GameID, in.MoveNumber); err != nil {
	return nil, err
}
return h.workspaceState(ctx, token)
```

- [ ] **Step 6: Update `ServeWS` notification**

Keep the notification method as `analysis.update`, but ensure params is the full `StatePayload`:

```go
state, err := h.workspaceState(ctx, token)
if err != nil {
	return
}
_ = conn.WriteJSON(server.Notify("analysis.update", state))
```

- [ ] **Step 7: Run tests**

Run:

```powershell
go test .\internal\app .\internal\server -count=1
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add internal/app internal/server
git commit -m "feat: push columnar workspace state"
```

## Task 6: Frontend Columnar Types, Selectors, and App State

**Files:**
- Modify: `web/src/api/types.ts`
- Create: `web/src/state/selectors.ts`
- Create: `web/src/state/selectors.test.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.state.test.ts`

- [ ] **Step 1: Write selector tests**

Create `web/src/state/selectors.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { candidateAt, chartPointsForState, currentCandidates, pointLossForCandidate } from './selectors'
import type { StatePayload } from '../api/types'

const state: StatePayload = {
  type: 'state',
  schema: 1,
  games: [],
  gameId: 'game-1',
  currentNodeId: 'main:0',
  analysisState: 'running',
  snapshot: {
    gameId: 'game-1',
    nodeId: 'main:0',
    moveNumber: 0,
    totalMoves: 1,
    branchMode: 'main',
    stones: [],
    children: [],
    toPlay: 'B',
    rules: 'chinese',
    komi: 7.5,
    blackName: 'B',
    whiteName: 'W',
    result: '',
    captures: { B: 0, W: 0 },
    gameEnded: false,
    canPrevious: false,
    canNext: true,
    canBackToMain: false,
  },
  timeline: {
    nodeIds: ['main:0', 'main:1'],
    moves: [null, 'Q16'],
    moveColors: [null, 'B'],
    passes: [false, false],
    toPlays: ['B', 'W'],
    rootWinrates: [0.52, null],
    rootScoreLeads: [1.4, null],
    rootVisits: [100, null],
    playedPointLosses: [null, null],
  },
  badMoves: { nodeIds: [], moveNumbers: [], colors: [], moves: [], pointLosses: [] },
  current: {
    nodeId: 'main:0',
    candidates: {
      moves: ['Q16', 'D4'],
      orders: [0, 1],
      visits: [100, 20],
      winrates: [0.54, 0.51],
      scoreLeads: [2.0, 1.2],
      pvs: [['Q16'], ['D4']],
    },
  },
}

describe('columnar state selectors', () => {
  it('builds chart points from analyzed timeline values', () => {
    expect(chartPointsForState(state)).toEqual([{ moveNumber: 0, winrate: 0.52, scoreLead: 1.4 }])
  })

  it('inflates current candidates and derives KaTrain pointsLost', () => {
    const candidates = currentCandidates(state)
    expect(candidates).toHaveLength(2)
    expect(candidateAt(state, 1)?.move).toBe('D4')
    expect(pointLossForCandidate(state, candidates[1])).toBeCloseTo(0.2)
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
cd web
npm test -- --run src/state/selectors.test.ts
```

Expected: FAIL because `StatePayload` and selectors do not exist.

- [ ] **Step 3: Update API types**

Replace old analysis view types in `web/src/api/types.ts` with:

```ts
export interface StatePayload {
  type: 'state'
  schema: 1
  games: GameRecord[]
  gameId?: string
  currentNodeId?: string
  analysisState: AnalysisState
  snapshot?: Snapshot
  timeline?: TimelineColumns
  badMoves?: BadMoveColumns
  variation?: VariationState
  current?: CurrentNodeState
}

export interface TimelineColumns {
  nodeIds: string[]
  moves: Array<string | null>
  moveColors: Array<Color | null>
  passes: boolean[]
  toPlays: Color[]
  rootWinrates: Array<number | null>
  rootScoreLeads: Array<number | null>
  rootVisits: Array<number | null>
  playedPointLosses: Array<number | null>
}

export interface BadMoveColumns {
  nodeIds: string[]
  moveNumbers: number[]
  colors: Color[]
  moves: string[]
  pointLosses: number[]
}

export interface VariationState {
  baseNodeId: string
  baseMoveNumber: number
  currentNodeId: string
  timeline: TimelineColumns
}

export interface CurrentNodeState {
  nodeId: string
  candidates: CandidateColumns
  ownership?: EncodedOwnership
}

export interface CandidateColumns {
  moves: string[]
  orders: number[]
  visits: number[]
  winrates: number[]
  scoreLeads: number[]
  pvs: string[][]
}

export interface EncodedOwnership {
  encoding: 'q8-base64'
  data: string
}

export interface CandidateView {
  move: string
  order: number
  visits: number
  winrate: number
  scoreLead: number
  pv: string[]
}
```

Remove `WorkspaceState`, `ChartPoint` object reliance, and derived candidate fields from API types. Keep `ChartPoint` as frontend render type:

```ts
export interface ChartPoint {
  moveNumber: number
  winrate: number
  scoreLead: number
}
```

- [ ] **Step 4: Implement selectors**

Create `web/src/state/selectors.ts`:

```ts
import type { BadMove, CandidateView, ChartPoint, StatePayload, TimelineColumns } from '../api/types'

export function chartPointsForState(state?: StatePayload): ChartPoint[] {
  const timeline = activeTimeline(state)
  if (!timeline) return []
  const base = state?.variation ? state.variation.baseMoveNumber + 1 : 0
  const points: ChartPoint[] = []
  for (let i = 0; i < timeline.nodeIds.length; i++) {
    const winrate = timeline.rootWinrates[i]
    const scoreLead = timeline.rootScoreLeads[i]
    if (winrate === null || scoreLead === null) continue
    points.push({ moveNumber: base + i, winrate, scoreLead })
  }
  return points
}

export function activeTimeline(state?: StatePayload): TimelineColumns | undefined {
  return state?.variation ? state.variation.timeline : state?.timeline
}

export function currentCandidates(state?: StatePayload): CandidateView[] {
  const columns = state?.current?.candidates
  if (!columns) return []
  return columns.moves.map((move, index) => ({
    move,
    order: columns.orders[index],
    visits: columns.visits[index],
    winrate: columns.winrates[index],
    scoreLead: columns.scoreLeads[index],
    pv: columns.pvs[index] ?? [],
  }))
}

export function candidateAt(state: StatePayload, index: number): CandidateView | undefined {
  return currentCandidates(state)[index]
}

export function pointLossForCandidate(state: StatePayload, candidate: CandidateView): number {
  const root = rootForCurrent(state)
  if (!root) return 0
  const sign = state.snapshot?.toPlay === 'W' ? -1 : 1
  return sign * (root.scoreLead - candidate.scoreLead)
}

export function lowVisits(candidate: CandidateView): boolean {
  return candidate.visits < 25 && candidate.order !== 0
}

export function badMovesForState(state?: StatePayload): BadMove[] {
  const columns = state?.badMoves
  if (!columns) return []
  return columns.nodeIds.map((nodeId, index) => ({
    nodeId,
    moveNumber: columns.moveNumbers[index],
    color: columns.colors[index],
    move: columns.moves[index],
    pointLoss: columns.pointLosses[index],
  }))
}

function rootForCurrent(state: StatePayload): { winrate: number; scoreLead: number } | undefined {
  const timeline = activeTimeline(state)
  if (!timeline || !state.current) return undefined
  const index = timeline.nodeIds.indexOf(state.current.nodeId)
  if (index < 0) return undefined
  const winrate = timeline.rootWinrates[index]
  const scoreLead = timeline.rootScoreLeads[index]
  if (winrate === null || scoreLead === null) return undefined
  return { winrate, scoreLead }
}
```

- [ ] **Step 5: Update `App.tsx` state shape**

In `web/src/App.tsx`, replace separate `games`, `selectedGameId`, `snapshot`, `chartPoints`, `badMoves`, and `analysisState` state with:

```ts
const [workspace, setWorkspace] = useState<StatePayload>({ type: 'state', schema: 1, games: [], analysisState: 'idle' })
const games = workspace.games
const selectedGameId = workspace.gameId
const snapshot = workspace.snapshot
const chartPoints = chartPointsForState(workspace)
const badMoves = badMovesForState(workspace)
const candidates = currentCandidates(workspace)
const analysisState = workspace.analysisState
```

Update notification and calls to use `StatePayload`:

```ts
nextClient.on('analysis.update', (params) => setWorkspace(params as StatePayload))
const state = await nextClient.call<StatePayload>('workspace.state')
setWorkspace(state)
```

For state-changing calls, prefer the returned state:

```ts
const state = await client.call<StatePayload>('game.goto', { gameId: selectedGameId, moveNumber })
setWorkspace(state)
```

- [ ] **Step 6: Run frontend tests**

Run:

```powershell
cd web
npm test -- --run src/state/selectors.test.ts src/App.state.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add web/src/api/types.ts web/src/state web/src/App.tsx
git commit -m "feat: consume columnar workspace state"
```

## Task 7: KaTrain Display Helpers and Ownership Decoding

**Files:**
- Create: `web/src/board/coordinates.ts`
- Create: `web/src/board/katrainStyle.ts`
- Create: `web/src/board/katrainStyle.test.ts`
- Create: `web/src/board/ownership.ts`
- Create: `web/src/board/ownership.test.ts`
- Modify: `web/src/components/Board.tsx`

- [ ] **Step 1: Write style helper tests**

Create `web/src/board/katrainStyle.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { evalClassForPointLoss, formatCandidateDelta, katrainEvalColor } from './katrainStyle'

describe('KaTrain style helpers', () => {
  it('maps point loss to KaTrain classes', () => {
    expect(evalClassForPointLoss(13)).toBe(0)
    expect(evalClassForPointLoss(7)).toBe(1)
    expect(evalClassForPointLoss(4)).toBe(2)
    expect(evalClassForPointLoss(2)).toBe(3)
    expect(evalClassForPointLoss(0.7)).toBe(4)
    expect(evalClassForPointLoss(0)).toBe(5)
  })

  it('formats KaTrain candidate delta as negative pointsLost', () => {
    expect(formatCandidateDelta(1.25)).toBe('-1.3')
    expect(formatCandidateDelta(-0.4)).toBe('+0.4')
  })

  it('returns green for class five', () => {
    expect(katrainEvalColor(0)).toBe('#1e9600')
  })
})
```

- [ ] **Step 2: Write ownership decode tests**

Create `web/src/board/ownership.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { decodeOwnershipQ8, ownershipAt } from './ownership'

describe('ownership helpers', () => {
  it('decodes q8 base64 into signed ownership values', () => {
    const data = btoa(String.fromCharCode(129, 0, 127))
    const decoded = decodeOwnershipQ8({ encoding: 'q8-base64', data })
    expect(decoded[0]).toBeCloseTo(-1)
    expect(decoded[1]).toBe(0)
    expect(decoded[2]).toBeCloseTo(1)
  })

  it('indexes ownership by x y', () => {
    const values = Array.from({ length: 361 }, (_, i) => i / 127)
    expect(ownershipAt(values, 3, 4)).toBe(values[4 * 19 + 3])
  })
})
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```powershell
cd web
npm test -- --run src/board/katrainStyle.test.ts src/board/ownership.test.ts
```

Expected: FAIL because helper modules do not exist.

- [ ] **Step 4: Implement coordinate helpers**

Create `web/src/board/coordinates.ts`:

```ts
export const BOARD_SIZE = 19
export const GTP_LETTERS = 'ABCDEFGHJKLMNOPQRST'

export interface BoardPoint {
  x: number
  y: number
}

export function pointToGTP(x: number, y: number) {
  return `${GTP_LETTERS[x]}${BOARD_SIZE - y}`
}

export function gtpToPoint(gtp: string): BoardPoint | null {
  if (gtp.toLowerCase() === 'pass') return null
  const x = GTP_LETTERS.indexOf(gtp[0]?.toUpperCase())
  const row = Number(gtp.slice(1))
  if (x < 0 || !row) return null
  return { x, y: BOARD_SIZE - row }
}

export function boardPoints() {
  return Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => ({ x: index % BOARD_SIZE, y: Math.floor(index / BOARD_SIZE) }))
}

export function pointKey(x: number, y: number) {
  return `${x}:${y}`
}
```

- [ ] **Step 5: Implement KaTrain style helpers**

Create `web/src/board/katrainStyle.ts`:

```ts
export const KATRAIN_THRESHOLDS = [12, 6, 3, 1.5, 0.5, 0]
export const KATRAIN_EVAL_COLORS = ['#72216b', '#cc0000', '#e6661a', '#f2f200', '#abdf2e', '#1e9600']
export const TOP_MOVE_BORDER_COLOR = '#0ac8fa'

export function evalClassForPointLoss(pointLoss: number) {
  let index = 0
  while (index < KATRAIN_THRESHOLDS.length - 1 && pointLoss < KATRAIN_THRESHOLDS[index]) index += 1
  return index
}

export function katrainEvalColor(pointLoss: number) {
  return KATRAIN_EVAL_COLORS[evalClassForPointLoss(pointLoss)]
}

export function formatCandidateDelta(pointsLost: number) {
  const value = -pointsLost
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`
}

export function formatVisits(visits: number) {
  if (visits < 1000) return String(visits)
  if (visits < 100000) return `${(visits / 1000).toFixed(1)}k`
  if (visits < 1000000) return `${(visits / 1000).toFixed(0)}k`
  return `${(visits / 1000000).toFixed(0)}M`
}
```

- [ ] **Step 6: Implement ownership helpers**

Create `web/src/board/ownership.ts`:

```ts
import type { EncodedOwnership } from '../api/types'

export function decodeOwnershipQ8(ownership?: EncodedOwnership): number[] {
  if (!ownership || ownership.encoding !== 'q8-base64') return []
  const raw = atob(ownership.data)
  return Array.from(raw, (char) => {
    const byte = char.charCodeAt(0)
    const signed = byte > 127 ? byte - 256 : byte
    return signed / 127
  })
}

export function ownershipAt(values: number[], x: number, y: number) {
  return values[y * 19 + x] ?? 0
}

export function ownershipOwner(value: number): 'B' | 'W' {
  return value >= 0 ? 'B' : 'W'
}

export function ownershipAlpha(value: number) {
  return Math.pow(Math.abs(value), 1 / 1.33)
}
```

- [ ] **Step 7: Run tests**

Run:

```powershell
cd web
npm test -- --run src/board/katrainStyle.test.ts src/board/ownership.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add web/src/board
git commit -m "feat: add katrain board display helpers"
```

## Task 8: Board Overlay Layers, Toggles, and Current Move Quality

**Files:**
- Modify: `web/src/components/Board.tsx`
- Modify: `web/src/components/Board.test.tsx`
- Create: `web/src/components/OverlayToggles.tsx`
- Create: `web/src/components/OverlayToggles.test.tsx`
- Modify: `web/src/styles.css`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Write board overlay rendering test**

Replace or extend `web/src/components/Board.test.tsx` with:

```tsx
it('renders ownership, dead stone marks, candidate colors, and current move quality when enabled', () => {
  const ownershipBytes = new Uint8Array(361)
  ownershipBytes[3 * 19 + 15] = 129
  const ownership = btoa(String.fromCharCode(...ownershipBytes))
  render(
    <Board
      snapshot={{
        gameId: 'g',
        nodeId: 'main:1',
        moveNumber: 1,
        totalMoves: 1,
        branchMode: 'main',
        stones: [{ x: 15, y: 3, color: 'B' }],
        lastMove: { nodeId: 'main:1', moveNumber: 1, color: 'B', gtp: 'Q16', pass: false },
        children: [],
        toPlay: 'W',
        rules: 'chinese',
        komi: 7.5,
        blackName: 'B',
        whiteName: 'W',
        result: '',
        captures: { B: 0, W: 0 },
        gameEnded: false,
        canPrevious: true,
        canNext: false,
        canBackToMain: false,
      }}
      candidates={[{ move: 'D16', order: 0, visits: 500, winrate: 0.5, scoreLead: 0, pv: ['D16'] }]}
      ownership={{ encoding: 'q8-base64', data: ownership }}
      playedPointLoss={3}
      overlays={{ candidates: true, ownership: true, deadStones: true }}
      activePV={undefined}
      tryMode={false}
      onPlay={vi.fn()}
      onPreviewPV={vi.fn()}
    />,
  )
  expect(screen.getByLabelText('Ownership overlay')).toBeInTheDocument()
  expect(screen.getByLabelText('Weak stone marker Q16')).toBeInTheDocument()
  expect(screen.getByLabelText('Current move quality Q16')).toBeInTheDocument()
  expect(screen.getByLabelText('Recommended next move D16')).toBeInTheDocument()
})
```

- [ ] **Step 2: Write overlay toggle persistence test**

Create `web/src/components/OverlayToggles.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { OverlayToggles } from './OverlayToggles'

describe('OverlayToggles', () => {
  it('toggles candidate overlay', async () => {
    const onChange = vi.fn()
    render(<OverlayToggles value={{ candidates: true, ownership: true, deadStones: true }} onChange={onChange} />)
    await userEvent.click(screen.getByLabelText('Toggle recommended moves'))
    expect(onChange).toHaveBeenCalledWith({ candidates: false, ownership: true, deadStones: true })
  })
})
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```powershell
cd web
npm test -- --run src/components/Board.test.tsx src/components/OverlayToggles.test.tsx
```

Expected: FAIL because props and toggle component do not exist.

- [ ] **Step 4: Implement overlay toggles**

Create `web/src/components/OverlayToggles.tsx`:

```tsx
export interface OverlayState {
  candidates: boolean
  ownership: boolean
  deadStones: boolean
}

interface OverlayTogglesProps {
  value: OverlayState
  onChange(value: OverlayState): void
}

export function OverlayToggles({ value, onChange }: OverlayTogglesProps) {
  return (
    <div className="overlay-toggles" aria-label="Board overlays">
      <button aria-label="Toggle recommended moves" className={value.candidates ? 'toggle active' : 'toggle'} onClick={() => onChange({ ...value, candidates: !value.candidates })}>
        点
      </button>
      <button aria-label="Toggle ownership" className={value.ownership ? 'toggle active' : 'toggle'} onClick={() => onChange({ ...value, ownership: !value.ownership })}>
        势
      </button>
      <button aria-label="Toggle weak stones" className={value.deadStones ? 'toggle active' : 'toggle'} onClick={() => onChange({ ...value, deadStones: !value.deadStones })}>
        死
      </button>
    </div>
  )
}
```

Add helper hooks in `App.tsx`:

```ts
const defaultOverlays = { candidates: true, ownership: true, deadStones: true }
const [overlays, setOverlays] = useState(() => {
  const raw = localStorage.getItem('jcgo.boardOverlays')
  return raw ? { ...defaultOverlays, ...JSON.parse(raw) } : defaultOverlays
})
const updateOverlays = (value: typeof defaultOverlays) => {
  setOverlays(value)
  localStorage.setItem('jcgo.boardOverlays', JSON.stringify(value))
}
```

- [ ] **Step 5: Refactor `Board` props**

Modify `web/src/components/Board.tsx` props:

```ts
import type { CandidateView, EncodedOwnership, Snapshot } from '../api/types'
import type { OverlayState } from './OverlayToggles'

interface BoardProps {
  snapshot?: Snapshot
  candidates: CandidateView[]
  ownership?: EncodedOwnership
  playedPointLoss?: number | null
  overlays: OverlayState
  activePV?: string[]
  tryMode: boolean
  onPlay(gtp: string): void
  onPreviewPV(candidate: CandidateView): void
}
```

Use helpers from `web/src/board` and render layers in this order:

```tsx
<g className="ownership-layer" aria-label="Ownership overlay">...</g>
<g className="grid-layer">...</g>
<g className="stone-layer">...</g>
<g className="weak-stone-layer">...</g>
<g className="current-quality-layer">...</g>
<g className="candidate-layer">...</g>
<g className="actual-next-layer">...</g>
<g className="pv-layer">...</g>
<g className="click-target-layer">...</g>
```

For ownership points, render soft rectangles centered on intersections:

```tsx
{overlays.ownership && ownershipValues.map((value, index) => {
  const x = index % 19
  const y = Math.floor(index / 19)
  const alpha = ownershipAlpha(value)
  if (alpha === 0) return null
  return <rect key={index} x={pad + x * gap - gap / 2} y={pad + y * gap - gap / 2} width={gap} height={gap} fill={value >= 0 ? 'rgba(0,0,26,1)' : 'rgba(235,235,255,1)'} opacity={alpha * 0.75} />
})}
```

For weak stone markers:

```tsx
{overlays.deadStones && stones.map((stone) => {
  const value = ownershipAt(ownershipValues, stone.x, stone.y)
  if (stone.color === ownershipOwner(value) || value === 0) return null
  const size = gap * 0.43 * 2 * 0.42 * Math.abs(value)
  return <rect aria-label={`Weak stone marker ${pointToGTP(stone.x, stone.y)}`} x={pad + stone.x * gap - size / 2} y={pad + stone.y * gap - size / 2} width={size} height={size} fill={ownershipOwner(value) === 'B' ? '#111' : '#f5f2ea'} opacity="0.9" />
})}
```

For current move quality:

```tsx
{lastMovePoint && playedPointLoss !== undefined && playedPointLoss !== null && (
  <circle aria-label={`Current move quality ${snapshot.lastMove.gtp}`} cx={pad + lastMovePoint.x * gap} cy={pad + lastMovePoint.y * gap} r={gap * 0.13} fill={katrainEvalColor(playedPointLoss)} />
)}
```

- [ ] **Step 6: Wire board props from App**

In `App.tsx`, pass:

```tsx
<OverlayToggles value={overlays} onChange={updateOverlays} />
<Board
  snapshot={snapshot}
  candidates={candidates}
  ownership={workspace.current?.ownership}
  playedPointLoss={playedPointLossForCurrent(workspace)}
  overlays={overlays}
  activePV={activePV}
  tryMode={tryMode}
  onPlay={playMove}
  onPreviewPV={previewPV}
/>
```

Add `playedPointLossForCurrent` to selectors:

```ts
export function playedPointLossForCurrent(state?: StatePayload): number | null {
  const timeline = activeTimeline(state)
  const nodeId = state?.current?.nodeId
  if (!timeline || !nodeId) return null
  const index = timeline.nodeIds.indexOf(nodeId)
  if (index < 0) return null
  return timeline.playedPointLosses[index]
}
```

- [ ] **Step 7: Run frontend tests**

Run:

```powershell
cd web
npm test -- --run src/components/Board.test.tsx src/components/OverlayToggles.test.tsx
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add web/src/components web/src/board web/src/state web/src/App.tsx web/src/styles.css
git commit -m "feat: render katrain board overlays"
```

## Task 9: PV, Try Mode, Variation Timeline, and Charts

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/AnalysisCharts.tsx`
- Modify: `web/src/components/AnalysisCharts.test.tsx`
- Modify: `web/src/components/AnalysisDetailTabs.tsx`
- Modify: `web/src/components/NavigationControls.tsx`
- Modify: `web/src/components/NavigationControls.test.tsx`

- [ ] **Step 1: Write chart variation test**

Add to `web/src/components/AnalysisCharts.test.tsx`:

```tsx
it('renders variation move numbers using base move number', () => {
  render(
    <AnalysisCharts
      points={[
        { moveNumber: 121, winrate: 0.58, scoreLead: 2.4 },
        { moveNumber: 122, winrate: 0.55, scoreLead: 1.8 },
      ]}
      currentMoveNumber={122}
      onJump={vi.fn()}
    />,
  )
  expect(screen.getByText('121')).toBeInTheDocument()
  expect(screen.getByText('122')).toBeInTheDocument()
})
```

- [ ] **Step 2: Write PV/try-mode mutual exclusion test**

Add to `web/src/App.state.test.tsx`:

```tsx
it('clears PV when entering try mode', async () => {
  const user = userEvent.setup()
  render(<App />)
  await connectWithTokenAndState()
  await user.click(screen.getByLabelText('Recommended next move D16'))
  expect(screen.getByText('1')).toBeInTheDocument()
  await user.click(screen.getByLabelText('Enter try mode'))
  expect(screen.queryByText('1')).not.toBeInTheDocument()
})
```

Use the existing RPC test helper in `App.state.test.tsx`. If there is no helper, create a local `connectWithTokenAndState` that seeds `localStorage`, mocks `RPCClient`, and returns a `StatePayload` with one current candidate.

- [ ] **Step 3: Run tests to verify failure**

Run:

```powershell
cd web
npm test -- --run src/components/AnalysisCharts.test.tsx src/App.state.test.tsx
```

Expected: FAIL until `App` and chart state use columnar variation data.

- [ ] **Step 4: Ensure ordinary candidate click only previews PV**

In `App.tsx`, keep:

```ts
const previewPV = (candidate: CandidateView) => {
  if (tryMode) return
  setActivePV(candidate.pv)
}
```

Candidate clicks in `Board`:

```ts
if (tryMode) onPlay(candidate.move)
else onPreviewPV(candidate)
```

Right-side candidate list uses the same `previewPV` handler.

- [ ] **Step 5: Ensure entering try mode clears PV**

In `App.tsx`:

```ts
const enterTryMode = () => {
  setActivePV(undefined)
  setTryMode(true)
}
```

In `playMove`, keep try mode active and clear PV:

```ts
const playMove = async (move: string) => {
  if (!client || !selectedGameId) return
  const state = await client.call<StatePayload>('game.play', { gameId: selectedGameId, move })
  setWorkspace(state)
  setActivePV(undefined)
  setTryMode(true)
}
```

- [ ] **Step 6: Use active timeline chart points**

Use `chartPointsForState(workspace)` from selectors. When `workspace.variation` exists, it returns variation points with `baseMoveNumber + index + 1`, so `AnalysisCharts` does not need special variation props.

- [ ] **Step 7: Update NavigationControls labels**

Ensure `NavigationControls` has an always-available `Enter try mode` button when not in try mode:

```tsx
{!props.tryMode && <button aria-label="Enter try mode" onClick={props.onEnterTryMode}>试下</button>}
{props.tryMode && <button aria-label="Exit try mode" onClick={props.onExitTryMode}>退出试下</button>}
```

Remove unused close/clear branch buttons from the visible mobile control surface.

- [ ] **Step 8: Run frontend tests**

Run:

```powershell
cd web
npm test -- --run src/components/AnalysisCharts.test.tsx src/components/NavigationControls.test.tsx src/App.state.test.tsx
npm run build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add web/src/App.tsx web/src/components web/src/state
git commit -m "feat: align pv and try mode"
```

## Task 10: Responsive Board Info and Right Rail Ordering

**Files:**
- Create: `web/src/components/BoardInfo.tsx`
- Create: `web/src/components/BoardInfo.test.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/AnalysisPanel.tsx`
- Modify: `web/src/components/AnalysisDetailTabs.tsx`
- Modify: `web/src/styles.css`
- Modify: `web/src/styles.test.ts`

- [ ] **Step 1: Write BoardInfo test**

Create `web/src/components/BoardInfo.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BoardInfo } from './BoardInfo'

describe('BoardInfo', () => {
  it('shows players komi and rules', () => {
    render(<BoardInfo blackName="Lee" whiteName="Cho" komi={6.5} rules="japanese" />)
    expect(screen.getByText('黑 Lee')).toBeInTheDocument()
    expect(screen.getByText('白 Cho')).toBeInTheDocument()
    expect(screen.getByText('贴目 6.5')).toBeInTheDocument()
    expect(screen.getByText('japanese')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
cd web
npm test -- --run src/components/BoardInfo.test.tsx
```

Expected: FAIL because `BoardInfo` does not exist.

- [ ] **Step 3: Implement BoardInfo**

Create `web/src/components/BoardInfo.tsx`:

```tsx
interface BoardInfoProps {
  blackName?: string
  whiteName?: string
  komi?: number
  rules?: string
}

export function BoardInfo({ blackName, whiteName, komi, rules }: BoardInfoProps) {
  return (
    <aside className="board-info" aria-label="棋局信息">
      <span>黑 {blackName || '黑'}</span>
      <span>白 {whiteName || '白'}</span>
      <span>贴目 {(komi ?? 7.5).toFixed(1)}</span>
      <span>{rules || 'chinese'}</span>
    </aside>
  )
}
```

- [ ] **Step 4: Wire BoardInfo into board stage**

In `App.tsx`, wrap board with:

```tsx
<section className="board-stage">
  <div className="board-layout">
    <BoardInfo blackName={snapshot?.blackName} whiteName={snapshot?.whiteName} komi={snapshot?.komi} rules={snapshot?.rules} />
    <Board ... />
  </div>
  {error && <p className="app-error">{error}</p>}
</section>
```

- [ ] **Step 5: Update right rail ordering**

In `App.tsx`, keep right rail order:

```tsx
<aside className="analysis-rail">
  <section className="analysis-overview rail-section" aria-label="局面曲线">
    <AnalysisPanel analysis={currentRootSummary} />
    <AnalysisCharts points={chartPoints} currentMoveNumber={snapshot?.moveNumber} onJump={...} />
  </section>
  <AnalysisDetailTabs badMoves={badMoves} candidates={candidates} ... />
</aside>
```

`AnalysisPanel` should consume a root summary object:

```ts
interface AnalysisSummary {
  winrate: number
  scoreLead: number
  visits: number
}
```

Build it from selectors:

```ts
const currentRootSummary = rootSummaryForCurrent(workspace)
```

- [ ] **Step 6: Add responsive CSS**

In `web/src/styles.css`, add:

```css
.board-layout {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.board-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
}

@container board-stage (max-aspect-ratio: 19 / 10) {
  .board-layout {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }
  .board-info {
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
  }
}
```

If container queries are not already enabled for `.board-stage`, add:

```css
.board-stage {
  container-type: size;
  container-name: board-stage;
}
```

- [ ] **Step 7: Run tests and build**

Run:

```powershell
cd web
npm test -- --run src/components/BoardInfo.test.tsx src/styles.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add web/src/components web/src/App.tsx web/src/styles.css
git commit -m "feat: add responsive board info"
```

## Task 11: Backend State Compatibility Cleanup

**Files:**
- Modify: `internal/game/types.go`
- Modify: `internal/app/workspace.go`
- Modify: `internal/app/handlers.go`
- Modify: `web/src/api/types.ts`
- Modify: all tests that still reference old `Snapshot.Analysis`, `WorkspaceState.chartPoints`, `CandidateMove.pointLoss`, or `BadMove.class`

- [ ] **Step 1: Search for old protocol fields**

Run:

```powershell
rg -n "Snapshot\\.Analysis|\\.Analysis|WorkspaceState|chartPoints|CandidateMove|pointLoss|relativePointLoss|winrateLoss|lowVisits|class:" internal web/src
```

Expected: output shows remaining old protocol references.

- [ ] **Step 2: Remove `Snapshot.Analysis` from backend snapshot**

In `internal/game/types.go`, ensure `Snapshot` has no `Analysis *AnalysisResult` field.

In `internal/app/workspace.go`, remove `withAnalysisLocked` and replace its call sites with raw `g.CurrentSnapshot()` because current detail now lives in `StatePayload.Current`.

- [ ] **Step 3: Remove old frontend API types**

In `web/src/api/types.ts`, remove:

```ts
export interface CandidateMove { ... }
export interface AnalysisResult { ... }
export interface WorkspaceState { ... }
```

Use `CandidateView`, `StatePayload`, `CurrentNodeState`, and selectors instead.

- [ ] **Step 4: Update remaining component tests**

For tests that need candidates, use:

```ts
const candidate = { move: 'Q16', order: 0, visits: 400, winrate: 0.63, scoreLead: 4.4, pv: ['Q16'] }
```

For tests that need bad moves, use:

```ts
const badMove = { nodeId: 'main:12', moveNumber: 12, color: 'B' as const, move: 'Q16', pointLoss: 3.5 }
```

- [ ] **Step 5: Run compatibility search again**

Run:

```powershell
rg -n "Snapshot\\.Analysis|WorkspaceState|CandidateMove|relativePointLoss|winrateLoss|lowVisits|class:" internal web/src
```

Expected: no matches, except prose in tests if deliberately asserting absence.

- [ ] **Step 6: Run tests**

Run:

```powershell
go test .\internal\game .\internal\app .\internal\katago -count=1
cd web
npm test -- --run
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add internal web/src
git commit -m "refactor: remove old analysis protocol"
```

## Task 12: End-to-End Verification for New Analysis UX

**Files:**
- Modify: `e2e/jcgo.spec.ts`
- Modify: `playwright.config.ts` if viewport labels need adjustment
- Modify: `README.md`

- [ ] **Step 1: Add e2e test for PV preview and try mode**

Append to `e2e/jcgo.spec.ts`:

```ts
test('previews PV then enters and exits try mode', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Access token').fill(process.env.JCGO_E2E_TOKEN ?? '213509')
  await page.getByRole('button', { name: 'Connect' }).click()
  await page.getByLabel('Import SGF').click()
  await page.setInputFiles('input[type="file"]', 'testdata/sgf/simple-19.sgf')
  await page.getByRole('button', { name: 'Import' }).click()
  await page.getByRole('button', { name: /Start analysis|Run/ }).click()
  await expect(page.getByLabel(/Recommended next move/).first()).toBeVisible({ timeout: 30000 })
  await page.getByLabel(/Recommended next move/).first().click()
  await expect(page.locator('.pv-layer')).toBeVisible()
  await page.getByLabel('Enter try mode').click()
  await expect(page.locator('.pv-layer')).toHaveCount(0)
  await page.getByLabel(/Try move/).first().click()
  await expect(page.getByLabel('Exit try mode')).toBeVisible()
  await page.getByLabel('Exit try mode').click()
  await expect(page.getByLabel('Enter try mode')).toBeVisible()
})
```

- [ ] **Step 2: Add e2e test for overlay toggles**

Append to `e2e/jcgo.spec.ts`:

```ts
test('board overlay toggles persist in local storage', async ({ page }) => {
  await page.goto('/')
  const token = process.env.JCGO_E2E_TOKEN ?? '213509'
  await page.evaluate((value) => localStorage.setItem('jcgo.accessToken', value), token)
  await page.reload()
  await page.getByLabel('Toggle ownership').click()
  await expect(page.getByLabel('Toggle ownership')).not.toHaveClass(/active/)
  await page.reload()
  await expect(page.getByLabel('Toggle ownership')).not.toHaveClass(/active/)
})
```

- [ ] **Step 3: Update README with new protocol summary**

Add this section to `README.md`:

```markdown
## Analysis State Protocol

The server sends full workspace state as a columnar `state` payload. The main `timeline` is fixed-length (`totalMoves + 1`) and uses `null` for unanalyzed root values. The `current` section contains only the selected node's candidate moves and q8-base64 ownership data. Variation analysis uses a separate `variation.timeline` and is deleted when leaving try mode.
```

- [ ] **Step 4: Run full verification**

Run:

```powershell
go test ./...
```

Expected: PASS.

Run:

```powershell
cd web
npm test -- --run
npm run build
```

Expected: PASS.

Run Playwright only with a running server configured with KataGo:

```powershell
$env:JCGO_E2E_TOKEN='213509'
npx playwright test
```

Expected: PASS. If KataGo is not configured, record that e2e analysis tests were skipped because the engine was unavailable and run all unit/component tests instead.

- [ ] **Step 5: Commit**

```powershell
git add e2e README.md playwright.config.ts
git commit -m "test: cover refreshed analysis ux"
```

## Final Verification Checklist

Run from `D:\Code\JCGO`:

```powershell
go test ./...
```

Expected: PASS.

Run:

```powershell
cd web
npm test -- --run
npm run build
```

Expected: PASS.

Manual verification with server running at `http://127.0.0.1:4380/` and token `213509`:

- Import a 19x19 SGF.
- Start analysis.
- Confirm `analysis.update` payload has `type: "state"` and columnar `timeline`.
- Confirm ownership overlay appears when ownership is present.
- Toggle recommended moves, ownership, and weak stones from the left toolbar; reload and confirm toggle state persists.
- Click a candidate in ordinary mode and confirm PV appears without entering try mode.
- Enter try mode, click an empty point, and confirm PV disappears and variation curve appears.
- Exit try mode and confirm variation data disappears and main bad move list remains unchanged.
- Reconnect with the same token and confirm current node, main analysis, and active variation state restore while the server process remains alive.

## Plan Review Notes

- The old v1 plan was replaced because it predated the confirmed ownership, columnar payload, and PV/try-mode decisions.
- The backend plan intentionally stores raw KataGo candidate values and ownership; frontend display-only values stay in selectors and board helpers.
- Mainline bad moves are server-derived business data. Candidate colors and labels remain frontend-derived KaTrain display data.
- The plan keeps SQLite as minimal game index storage and does not persist analysis caches.
