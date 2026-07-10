package app

import (
	"encoding/base64"
	"fmt"
	"strings"

	"jcgo/internal/game"
	"jcgo/internal/store"
	"jcgo/internal/worker"
)

type StatePayload struct {
	Type             string                `json:"type"`
	Schema           int                   `json:"schema"`
	Games            []store.GameRecord    `json:"games"`
	GameID           string                `json:"gameId"`
	CurrentNodeID    string                `json:"currentNodeId"`
	AnalysisState    AnalysisState         `json:"analysisState"`
	AnalysisError    string                `json:"analysisError,omitempty"`
	WorkerStatus     worker.StatusSnapshot `json:"workerStatus"`
	AnalysisSchedule ScheduleSnapshot      `json:"analysisSchedule"`
	Snapshot         game.Snapshot         `json:"snapshot"`
	Timeline         TimelineColumns       `json:"timeline"`
	BadMoves         BadMoveColumns        `json:"badMoves"`
	Variation        *VariationState       `json:"variation,omitempty"`
	Current          CurrentNodeState      `json:"current"`
}

type TimelineColumns struct {
	NodeIDs           []string   `json:"nodeIds"`
	Moves             []*string  `json:"moves"`
	MoveColors        []*string  `json:"moveColors"`
	Passes            []bool     `json:"passes"`
	ToPlays           []string   `json:"toPlays"`
	RootWinrates      []*float64 `json:"rootWinrates"`
	RootScoreLeads    []*float64 `json:"rootScoreLeads"`
	RootVisits        []*int     `json:"rootVisits"`
	PlayedPointLosses []*float64 `json:"playedPointLosses"`
}

type BadMoveColumns struct {
	NodeIDs     []string     `json:"nodeIds"`
	MoveNumbers []int        `json:"moveNumbers"`
	Colors      []game.Color `json:"colors"`
	Moves       []string     `json:"moves"`
	PointLosses []float64    `json:"pointLosses"`
}

type VariationState struct {
	BaseNodeID     string          `json:"baseNodeId"`
	BaseMoveNumber int             `json:"baseMoveNumber"`
	CurrentNodeID  string          `json:"currentNodeId"`
	Timeline       TimelineColumns `json:"timeline"`
}

type CurrentNodeState struct {
	NodeID     string            `json:"nodeId"`
	Candidates CandidateColumns  `json:"candidates"`
	Ownership  *EncodedOwnership `json:"ownership,omitempty"`
}

type CandidateColumns struct {
	Moves      []string   `json:"moves"`
	Orders     []int      `json:"orders"`
	Visits     []int      `json:"visits"`
	Winrates   []float64  `json:"winrates"`
	ScoreLeads []float64  `json:"scoreLeads"`
	PVs        [][]string `json:"pvs"`
}

type EncodedOwnership struct {
	Encoding string `json:"encoding"`
	Data     string `json:"data"`
}

func (w *Workspace) StatePayload(gameID string) (StatePayload, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	g, err := w.game(gameID)
	if err != nil {
		return StatePayload{}, err
	}
	snapshot := g.CurrentSnapshot()
	points, badMoves, analysisState, err := w.analysisViewLocked(gameID)
	if err != nil {
		return StatePayload{}, err
	}

	state := StatePayload{
		Type:          "state",
		Schema:        1,
		Games:         []store.GameRecord{},
		GameID:        gameID,
		CurrentNodeID: snapshot.NodeID,
		AnalysisState: analysisState,
		AnalysisError: w.analysisErrorLocked(gameID),
		Snapshot:      snapshot,
		Timeline:      w.timelineColumnsLocked(gameID, g.MainlineAnalysisInputs()),
		BadMoves:      badMoveColumns(badMoves),
		Current:       w.currentNodeStateLocked(gameID, snapshot.NodeID),
	}
	_ = points
	if inputs, baseMoveNumber, ok := g.CurrentVariationAnalysisInputs(); ok {
		state.Variation = &VariationState{
			BaseNodeID:     fmt.Sprintf("main:%d", baseMoveNumber),
			BaseMoveNumber: baseMoveNumber,
			CurrentNodeID:  snapshot.NodeID,
			Timeline:       w.timelineColumnsLocked(gameID, inputs),
		}
	}
	return state, nil
}

func (w *Workspace) timelineColumnsLocked(gameID string, inputs []game.AnalysisInput) TimelineColumns {
	columns := TimelineColumns{
		NodeIDs:           make([]string, 0, len(inputs)),
		Moves:             make([]*string, 0, len(inputs)),
		MoveColors:        make([]*string, 0, len(inputs)),
		Passes:            make([]bool, 0, len(inputs)),
		ToPlays:           make([]string, 0, len(inputs)),
		RootWinrates:      make([]*float64, 0, len(inputs)),
		RootScoreLeads:    make([]*float64, 0, len(inputs)),
		RootVisits:        make([]*int, 0, len(inputs)),
		PlayedPointLosses: make([]*float64, 0, len(inputs)),
	}
	for index, input := range inputs {
		columns.NodeIDs = append(columns.NodeIDs, input.NodeID)
		columns.Moves = append(columns.Moves, nullableString(input.Move))
		columns.MoveColors = append(columns.MoveColors, nullableColor(input.MoveColor))
		columns.Passes = append(columns.Passes, strings.EqualFold(input.Move, "pass"))
		columns.ToPlays = append(columns.ToPlays, string(input.ToPlay))

		analysis, ok := w.analysis[analysisCacheKey(gameID, input.NodeID)]
		if !ok {
			columns.RootWinrates = append(columns.RootWinrates, nil)
			columns.RootScoreLeads = append(columns.RootScoreLeads, nil)
			columns.RootVisits = append(columns.RootVisits, nil)
			columns.PlayedPointLosses = append(columns.PlayedPointLosses, nil)
			continue
		}
		columns.RootWinrates = append(columns.RootWinrates, float64Ptr(analysis.Root.Winrate))
		columns.RootScoreLeads = append(columns.RootScoreLeads, float64Ptr(analysis.Root.ScoreLead))
		columns.RootVisits = append(columns.RootVisits, intPtr(analysis.Root.Visits))
		if index == 0 {
			columns.PlayedPointLosses = append(columns.PlayedPointLosses, nil)
			continue
		}
		parent := inputs[index-1]
		parentAnalysis, ok := w.analysis[analysisCacheKey(gameID, parent.NodeID)]
		if !ok || input.Move == "" {
			columns.PlayedPointLosses = append(columns.PlayedPointLosses, nil)
			continue
		}
		columns.PlayedPointLosses = append(columns.PlayedPointLosses, float64Ptr(playedMovePointLoss(input.MoveColor, parentAnalysis.Root.ScoreLead, analysis.Root.ScoreLead)))
	}
	return columns
}

func (w *Workspace) currentNodeStateLocked(gameID string, nodeID string) CurrentNodeState {
	state := CurrentNodeState{
		NodeID:     nodeID,
		Candidates: emptyCandidateColumns(),
	}
	analysis, ok := w.analysis[analysisCacheKey(gameID, nodeID)]
	if !ok {
		return state
	}
	for _, candidate := range analysis.Candidates {
		state.Candidates.Moves = append(state.Candidates.Moves, candidate.Move)
		state.Candidates.Orders = append(state.Candidates.Orders, candidate.Order)
		state.Candidates.Visits = append(state.Candidates.Visits, candidate.Visits)
		state.Candidates.Winrates = append(state.Candidates.Winrates, candidate.Winrate)
		state.Candidates.ScoreLeads = append(state.Candidates.ScoreLeads, candidate.ScoreLead)
		state.Candidates.PVs = append(state.Candidates.PVs, append([]string(nil), candidate.PV...))
	}
	if len(analysis.OwnershipQ8) > 0 {
		state.Ownership = &EncodedOwnership{
			Encoding: "q8-base64",
			Data:     base64.StdEncoding.EncodeToString(analysis.OwnershipQ8),
		}
	}
	return state
}

func badMoveColumns(badMoves []game.BadMove) BadMoveColumns {
	columns := BadMoveColumns{
		NodeIDs:     []string{},
		MoveNumbers: []int{},
		Colors:      []game.Color{},
		Moves:       []string{},
		PointLosses: []float64{},
	}
	for _, badMove := range badMoves {
		columns.NodeIDs = append(columns.NodeIDs, badMove.NodeID)
		columns.MoveNumbers = append(columns.MoveNumbers, badMove.MoveNumber)
		columns.Colors = append(columns.Colors, badMove.Color)
		columns.Moves = append(columns.Moves, badMove.Move)
		columns.PointLosses = append(columns.PointLosses, badMove.PointLoss)
	}
	return columns
}

func emptyCandidateColumns() CandidateColumns {
	return CandidateColumns{
		Moves:      []string{},
		Orders:     []int{},
		Visits:     []int{},
		Winrates:   []float64{},
		ScoreLeads: []float64{},
		PVs:        [][]string{},
	}
}

func nullableString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func nullableColor(value game.Color) *string {
	if value == "" {
		return nil
	}
	color := string(value)
	return &color
}

func float64Ptr(value float64) *float64 {
	return &value
}

func intPtr(value int) *int {
	return &value
}
