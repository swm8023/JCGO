package app

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"

	"jcgo/internal/game"
)

type WorkspaceStore struct {
	mu         sync.Mutex
	workspaces map[string]*Workspace
}

type Workspace struct {
	mu             sync.Mutex
	games          map[string]*game.Game
	analysis       map[string]game.AnalysisResult
	analysisState  map[string]AnalysisState
	selectedGameID string
}

func NewWorkspaceStore() *WorkspaceStore {
	return &WorkspaceStore{workspaces: map[string]*Workspace{}}
}

func (s *WorkspaceStore) ForToken(token string) *Workspace {
	sum := sha256.Sum256([]byte(token))
	key := hex.EncodeToString(sum[:])

	s.mu.Lock()
	defer s.mu.Unlock()
	if ws := s.workspaces[key]; ws != nil {
		return ws
	}
	ws := newWorkspace()
	s.workspaces[key] = ws
	return ws
}

func newWorkspace() *Workspace {
	return &Workspace{
		games:         map[string]*game.Game{},
		analysis:      map[string]game.AnalysisResult{},
		analysisState: map[string]AnalysisState{},
	}
}

func (w *Workspace) LoadGame(gameID string, doc game.SGFDocument) error {
	g, err := game.NewFromSGF(gameID, doc)
	if err != nil {
		return err
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	w.games[gameID] = g
	w.clearAnalysisLocked(gameID)
	w.analysisState[gameID] = AnalysisIdle
	w.selectedGameID = gameID
	return nil
}

func (w *Workspace) HasGame(gameID string) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.games[gameID] != nil
}

func (w *Workspace) RemoveGame(gameID string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	delete(w.games, gameID)
	w.clearAnalysisLocked(gameID)
	delete(w.analysisState, gameID)
	if w.selectedGameID == gameID {
		w.selectedGameID = ""
	}
}

func (w *Workspace) SelectGame(gameID string) (game.Snapshot, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	g, err := w.game(gameID)
	if err != nil {
		return game.Snapshot{}, err
	}
	w.selectedGameID = gameID
	return w.withAnalysisLocked(gameID, g.CurrentSnapshot()), nil
}

func (w *Workspace) CurrentSnapshot(gameID string) (game.Snapshot, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	g, err := w.game(gameID)
	if err != nil {
		return game.Snapshot{}, err
	}
	return w.withAnalysisLocked(gameID, g.CurrentSnapshot()), nil
}

func (w *Workspace) GotoMain(gameID string, moveNumber int) (game.Snapshot, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	g, err := w.game(gameID)
	if err != nil {
		return game.Snapshot{}, err
	}
	w.selectedGameID = gameID
	snapshot, err := g.GotoMain(moveNumber)
	return w.withAnalysisLocked(gameID, snapshot), err
}

func (w *Workspace) Play(gameID string, gtp string) (game.Snapshot, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	g, err := w.game(gameID)
	if err != nil {
		return game.Snapshot{}, err
	}
	w.selectedGameID = gameID
	color := g.CurrentSnapshot().ToPlay
	snapshot, err := g.PlayVariation(color, gtp)
	return w.withAnalysisLocked(gameID, snapshot), err
}

func (w *Workspace) Pass(gameID string) (game.Snapshot, error) {
	return w.Play(gameID, "pass")
}

func (w *Workspace) BackToMain(gameID string) (game.Snapshot, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	g, err := w.game(gameID)
	if err != nil {
		return game.Snapshot{}, err
	}
	w.selectedGameID = gameID
	snapshot, err := g.BackToMain()
	return w.withAnalysisLocked(gameID, snapshot), err
}

func (w *Workspace) DeleteVariationNode(gameID string) (game.Snapshot, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	g, err := w.game(gameID)
	if err != nil {
		return game.Snapshot{}, err
	}
	w.selectedGameID = gameID
	snapshot, err := g.DeleteCurrentVariationNode()
	w.clearAnalysisLocked(gameID)
	w.analysisState[gameID] = AnalysisIdle
	return w.withAnalysisLocked(gameID, snapshot), err
}

func (w *Workspace) ClearVariation(gameID string) (game.Snapshot, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	g, err := w.game(gameID)
	if err != nil {
		return game.Snapshot{}, err
	}
	w.selectedGameID = gameID
	snapshot, err := g.ClearCurrentVariation()
	w.clearAnalysisLocked(gameID)
	w.analysisState[gameID] = AnalysisIdle
	return w.withAnalysisLocked(gameID, snapshot), err
}

func (w *Workspace) SetAnalysis(gameID string, nodeID string, result game.AnalysisResult) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.analysis[analysisCacheKey(gameID, nodeID)] = result
	if w.analysisCompleteLocked(gameID) {
		w.analysisState[gameID] = AnalysisComplete
		return
	}
	if w.analysisState[gameID] != AnalysisStopped {
		w.analysisState[gameID] = AnalysisRunning
	}
}

func (w *Workspace) MarkAnalysisStarted(gameID string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.analysisState[gameID] = AnalysisRunning
}

func (w *Workspace) MarkAnalysisStopped(gameID string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.analysisState[gameID] = AnalysisStopped
}

func (w *Workspace) ClearAnalysisAndVariations(gameID string, fallbackNodeID string) (game.Snapshot, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	g, err := w.game(gameID)
	if err != nil {
		return game.Snapshot{}, err
	}
	w.clearAnalysisLocked(gameID)
	w.analysisState[gameID] = AnalysisIdle
	snapshot, err := g.ClearCurrentVariation()
	if err != nil {
		return game.Snapshot{}, err
	}
	if strings.HasPrefix(fallbackNodeID, "main:") {
		var moveNumber int
		if _, scanErr := fmt.Sscanf(fallbackNodeID, "main:%d", &moveNumber); scanErr == nil {
			snapshot, err = g.GotoMain(moveNumber)
		}
	}
	return w.withAnalysisLocked(gameID, snapshot), err
}

func (w *Workspace) SelectedGameID() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.selectedGameID
}

func (w *Workspace) SelectedSnapshot() (*game.Snapshot, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.selectedGameID == "" {
		return nil, nil
	}
	g, err := w.game(w.selectedGameID)
	if err != nil {
		return nil, err
	}
	snapshot := w.withAnalysisLocked(w.selectedGameID, g.CurrentSnapshot())
	return &snapshot, nil
}

func (w *Workspace) AnalysisView(gameID string) ([]game.ChartPoint, []game.BadMove, AnalysisState, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	g, err := w.game(gameID)
	if err != nil {
		return nil, nil, AnalysisIdle, err
	}
	points := make([]game.ChartPoint, 0)
	badMoves := make([]game.BadMove, 0)
	var previousAnalysis game.AnalysisResult
	hasPreviousAnalysis := false
	for _, node := range g.MainlineAnalysisInputs() {
		analysis, ok := w.analysis[analysisCacheKey(gameID, node.NodeID)]
		if !ok {
			break
		}
		points = append(points, game.ChartPoint{
			MoveNumber: node.MoveNumber,
			Winrate:    analysis.Winrate,
			ScoreLead:  analysis.ScoreLead,
		})
		if hasPreviousAnalysis && node.Move != "" {
			pointsLost := playedMovePointLoss(node.MoveColor, previousAnalysis.ScoreLead, analysis.ScoreLead)
			if game.IsBadMove(pointsLost) {
				badMoves = append(badMoves, game.BadMove{
					NodeID:     node.NodeID,
					MoveNumber: node.MoveNumber,
					Color:      node.MoveColor,
					Move:       node.Move,
					PointLoss:  pointsLost,
					Class:      game.MistakeClass(pointsLost),
				})
			}
		}
		previousAnalysis = analysis
		hasPreviousAnalysis = true
	}
	return points, badMoves, w.analysisStateLocked(gameID), nil
}

func playedMovePointLoss(color game.Color, parentScore float64, score float64) float64 {
	sign := 1.0
	if color == game.White {
		sign = -1
	}
	return sign * (parentScore - score)
}

func (w *Workspace) MainlineAnalysisInputs(gameID string) []NodeInput {
	w.mu.Lock()
	defer w.mu.Unlock()
	g := w.games[gameID]
	if g == nil {
		return nil
	}
	return g.MainlineAnalysisInputs()
}

func (w *Workspace) game(gameID string) (*game.Game, error) {
	g := w.games[gameID]
	if g == nil {
		return nil, fmt.Errorf("game %s not loaded", gameID)
	}
	return g, nil
}

func (w *Workspace) withAnalysisLocked(gameID string, snapshot game.Snapshot) game.Snapshot {
	if analysis, ok := w.analysis[analysisCacheKey(gameID, snapshot.NodeID)]; ok {
		snapshot.Analysis = &analysis
	}
	return snapshot
}

func (w *Workspace) clearAnalysisLocked(gameID string) {
	prefix := gameID + ":"
	for key := range w.analysis {
		if strings.HasPrefix(key, prefix) {
			delete(w.analysis, key)
		}
	}
}

func (w *Workspace) analysisStateLocked(gameID string) AnalysisState {
	state := w.analysisState[gameID]
	if state == "" {
		state = AnalysisIdle
	}
	if state == AnalysisRunning && w.analysisCompleteLocked(gameID) {
		return AnalysisComplete
	}
	return state
}

func (w *Workspace) analysisCompleteLocked(gameID string) bool {
	g := w.games[gameID]
	if g == nil {
		return false
	}
	inputs := g.MainlineAnalysisInputs()
	if len(inputs) == 0 {
		return false
	}
	for _, node := range inputs {
		if _, ok := w.analysis[analysisCacheKey(gameID, node.NodeID)]; !ok {
			return false
		}
	}
	return true
}

func analysisCacheKey(gameID, nodeID string) string {
	return gameID + ":" + nodeID
}
