package game

import (
	"sort"

	"jcgo/internal/katago"
)

var KaTrainThresholds = []float64{12, 6, 3, 1.5, 0.5, 0}

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
