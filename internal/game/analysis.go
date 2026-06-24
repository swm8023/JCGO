package game

import (
	"sort"

	"jcgo/internal/katago"
)

var KaTrainThresholds = []float64{12, 6, 3, 1.5, 0.5, 0}

type AnalysisInput struct {
	NodeID        string
	MoveNumber    int
	ToPlay        Color
	Rules         string
	Komi          float64
	InitialStones []katago.Stone
	Moves         []katago.Move
}

func NormalizeAnalysis(toPlay Color, result katago.Result) AnalysisResult {
	rootScore := result.RootInfo.ScoreLead
	rootWinrate := result.RootInfo.Winrate
	sign := 1.0
	if toPlay == White {
		sign = -1
	}

	topScore := rootScore
	for _, move := range result.MoveInfos {
		if move.Order == 0 {
			topScore = move.ScoreLead
			break
		}
	}

	out := AnalysisResult{
		Winrate:   rootWinrate,
		ScoreLead: rootScore,
		Visits:    result.RootInfo.Visits,
	}
	for _, move := range result.MoveInfos {
		out.Candidates = append(out.Candidates, CandidateMove{
			Move:              move.Move,
			Order:             move.Order,
			Visits:            move.Visits,
			Winrate:           move.Winrate,
			ScoreLead:         move.ScoreLead,
			PointLoss:         sign * (rootScore - move.ScoreLead),
			RelativePointLoss: sign * (topScore - move.ScoreLead),
			WinrateLoss:       sign * (rootWinrate - move.Winrate),
			PV:                move.PV,
			LowVisits:         move.Visits < 25 && move.Order != 0,
		})
	}
	sort.SliceStable(out.Candidates, func(i, j int) bool {
		if out.Candidates[i].Order != out.Candidates[j].Order {
			return out.Candidates[i].Order < out.Candidates[j].Order
		}
		return out.Candidates[i].PointLoss < out.Candidates[j].PointLoss
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
	return pointsLost > 1.5
}

func (g *Game) MainlineAnalysisInputs() []AnalysisInput {
	initialStones := make([]katago.Stone, 0)
	for _, stone := range g.mainline[0].board.stones() {
		initialStones = append(initialStones, katago.Stone{Player: string(stone.Color), Move: FormatGTP(stone.X, stone.Y)})
	}

	var inputs []AnalysisInput
	var moves []katago.Move
	for i, node := range g.mainline {
		if i > 0 {
			moves = append(moves, katago.Move{Player: string(node.color), Move: node.gtp})
		}
		inputs = append(inputs, AnalysisInput{
			NodeID:        node.id,
			MoveNumber:    node.moveNumber,
			ToPlay:        node.toPlay,
			Rules:         g.rules,
			Komi:          g.komi,
			InitialStones: append([]katago.Stone(nil), initialStones...),
			Moves:         append([]katago.Move(nil), moves...),
		})
	}
	return inputs
}
