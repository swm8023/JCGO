package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"

	"jcgo/internal/game"
	"jcgo/internal/store"
)

const analysisFileSchema = 1

type persistedAnalysisFile struct {
	Schema int                              `json:"schema"`
	GameID string                           `json:"gameId"`
	Nodes  map[string]persistedAnalysisNode `json:"nodes"`
}

type persistedAnalysisNode struct {
	Root        game.RootAnalysis   `json:"root"`
	Candidates  []game.CandidateRaw `json:"candidates"`
	OwnershipQ8 string              `json:"ownershipQ8,omitempty"`
	Policy      []float64           `json:"policy,omitempty"`
}

func encodeAnalysisFile(gameID string, analysis map[string]game.AnalysisResult) ([]byte, error) {
	file := persistedAnalysisFile{
		Schema: analysisFileSchema,
		GameID: gameID,
		Nodes:  map[string]persistedAnalysisNode{},
	}
	for nodeID, result := range analysis {
		if !strings.HasPrefix(nodeID, "main:") {
			continue
		}
		node := persistedAnalysisNode{
			Root:       result.Root,
			Candidates: cloneAnalysisResult(result).Candidates,
			Policy:     append([]float64(nil), result.Policy...),
		}
		if len(result.OwnershipQ8) > 0 {
			node.OwnershipQ8 = base64.StdEncoding.EncodeToString(result.OwnershipQ8)
		}
		file.Nodes[nodeID] = node
	}
	return json.MarshalIndent(file, "", "  ")
}

func decodeAnalysisFile(data []byte, gameID string) (map[string]game.AnalysisResult, error) {
	var file persistedAnalysisFile
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, err
	}
	if file.Schema != analysisFileSchema {
		return nil, errors.New("unsupported analysis schema")
	}
	if file.GameID != gameID {
		return nil, errors.New("analysis game id mismatch")
	}
	out := map[string]game.AnalysisResult{}
	for nodeID, node := range file.Nodes {
		if !strings.HasPrefix(nodeID, "main:") {
			continue
		}
		result := game.AnalysisResult{
			Root:       node.Root,
			Candidates: append([]game.CandidateRaw(nil), node.Candidates...),
			Policy:     append([]float64(nil), node.Policy...),
		}
		for i := range result.Candidates {
			result.Candidates[i].PV = append([]string(nil), result.Candidates[i].PV...)
		}
		if node.OwnershipQ8 != "" {
			ownership, err := base64.StdEncoding.DecodeString(node.OwnershipQ8)
			if err != nil {
				return nil, err
			}
			result.OwnershipQ8 = ownership
		}
		out[nodeID] = result
	}
	return out, nil
}

func (h *Handler) loadPersistedAnalysis(ws *Workspace, record store.GameRecord) {
	data, err := h.files.ReadAnalysis(record.SGFFilename)
	if err != nil {
		return
	}
	analysis, err := decodeAnalysisFile(data, record.ID)
	if err != nil {
		return
	}
	ws.LoadMainlineAnalysis(record.ID, analysis)
}

func (h *Handler) persistMainlineAnalysis(ctx context.Context, gameID string, ws *Workspace) {
	record, err := h.repo.GetGame(ctx, gameID)
	if err != nil {
		return
	}
	analysis, err := ws.MainlineAnalysis(gameID)
	if err != nil {
		return
	}
	data, err := encodeAnalysisFile(gameID, analysis)
	if err != nil {
		return
	}
	_, _ = h.files.WriteAnalysis(record.SGFFilename, data)
}
