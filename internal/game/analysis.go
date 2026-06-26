package game

import (
	"sort"

	"jcgo/internal/katago"
)

var KaTrainThresholds = []float64{12, 6, 3, 1.5, 0.5, 0}

type AnalysisInput struct {
	NodeID        string
	MoveNumber    int
	MoveColor     Color
	Move          string
	ToPlay        Color
	InitialPlayer Color
	Rules         string
	Komi          float64
	InitialStones []katago.Stone
	Moves         []katago.Move
}

func NormalizeAnalysis(toPlay Color, result katago.Result) AnalysisResult {
	out := AnalysisResult{
		Root: RootAnalysis{
			Winrate:   result.RootInfo.Winrate,
			ScoreLead: result.RootInfo.ScoreLead,
			Visits:    result.RootInfo.Visits,
		},
		OwnershipQ8: EncodeOwnershipQ8(result.Ownership),
		Policy:      append([]float64(nil), result.Policy...),
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

func MistakeClass(pointsLost float64) int {
	index := 0
	for index < len(KaTrainThresholds)-1 && pointsLost < KaTrainThresholds[index] {
		index++
	}
	return index
}

func IsBadMove(pointsLost float64) bool {
	return pointsLost > KaTrainThresholds[len(KaTrainThresholds)-4]
}

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

func (g *Game) MainlineAnalysisInputs() []AnalysisInput {
	initialStones := g.initialAnalysisStones()

	var inputs []AnalysisInput
	var moves []katago.Move
	for i, node := range g.mainline {
		if i > 0 {
			moves = append(moves, katago.Move{Player: string(node.color), Move: node.gtp})
		}
		inputs = append(inputs, g.analysisInput(node, initialStones, moves))
	}
	return inputs
}

func (g *Game) CurrentAnalysisInput() (AnalysisInput, bool) {
	current, ok := g.node(g.currentID)
	if !ok {
		return AnalysisInput{}, false
	}
	path, ok := g.pathTo(current)
	if !ok {
		return AnalysisInput{}, false
	}

	moves := make([]katago.Move, 0, len(path)-1)
	for i, node := range path {
		if i == 0 {
			continue
		}
		moves = append(moves, katago.Move{Player: string(node.color), Move: node.gtp})
	}
	return g.analysisInput(current, g.initialAnalysisStones(), moves), true
}

func (g *Game) CurrentVariationAnalysisInputs() ([]AnalysisInput, int, bool) {
	current, ok := g.node(g.currentID)
	if !ok || isMainID(current.id) {
		return nil, 0, false
	}
	path, ok := g.pathTo(current)
	if !ok {
		return nil, 0, false
	}

	initialStones := g.initialAnalysisStones()
	moves := make([]katago.Move, 0, len(path)-1)
	inputs := make([]AnalysisInput, 0)
	for i, node := range path {
		if i > 0 {
			moves = append(moves, katago.Move{Player: string(node.color), Move: node.gtp})
		}
		if !isMainID(node.id) {
			inputs = append(inputs, g.analysisInput(node, initialStones, moves))
		}
	}
	return inputs, current.forkMoveNumber, true
}

func (g *Game) pathTo(current node) ([]node, bool) {
	reversed := []node{current}
	for current.parent != "" {
		parent, ok := g.node(current.parent)
		if !ok {
			return nil, false
		}
		reversed = append(reversed, parent)
		current = parent
	}
	path := make([]node, len(reversed))
	for i := range reversed {
		path[i] = reversed[len(reversed)-1-i]
	}
	return path, true
}

func (g *Game) initialAnalysisStones() []katago.Stone {
	initialStones := make([]katago.Stone, 0)
	for _, stone := range g.mainline[0].board.stones() {
		initialStones = append(initialStones, katago.Stone{Player: string(stone.Color), Move: FormatGTP(stone.X, stone.Y)})
	}
	return initialStones
}

func (g *Game) analysisInput(node node, initialStones []katago.Stone, moves []katago.Move) AnalysisInput {
	return AnalysisInput{
		NodeID:        node.id,
		MoveNumber:    node.moveNumber,
		MoveColor:     node.color,
		Move:          node.gtp,
		ToPlay:        node.toPlay,
		InitialPlayer: g.mainline[0].toPlay,
		Rules:         g.rules,
		Komi:          g.komi,
		InitialStones: append([]katago.Stone(nil), initialStones...),
		Moves:         append([]katago.Move(nil), moves...),
	}
}
