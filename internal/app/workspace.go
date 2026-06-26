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
	return g.CurrentSnapshot(), nil
}

func (w *Workspace) CurrentSnapshot(gameID string) (game.Snapshot, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	g, err := w.game(gameID)
	if err != nil {
		return game.Snapshot{}, err
	}
	return g.CurrentSnapshot(), nil
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
	return snapshot, err
}

func (w *Workspace) GotoNode(gameID string, nodeID string) (game.Snapshot, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	g, err := w.game(gameID)
	if err != nil {
		return game.Snapshot{}, err
	}
	w.selectedGameID = gameID
	snapshot, err := g.GotoNode(nodeID)
	return snapshot, err
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
	return snapshot, err
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
	return snapshot, err
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
	w.clearVariationAnalysisLocked(gameID)
	return snapshot, err
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
	w.clearVariationAnalysisLocked(gameID)
	return snapshot, err
}

func (w *Workspace) SetAnalysis(gameID string, nodeID string, result game.AnalysisResult) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.analysis[analysisCacheKey(gameID, nodeID)] = cloneAnalysisResult(result)
	if strings.HasPrefix(nodeID, "var:") {
		return
	}
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

func (w *Workspace) LoadMainlineAnalysis(gameID string, analysis map[string]game.AnalysisResult) {
	w.mu.Lock()
	defer w.mu.Unlock()
	g := w.games[gameID]
	if g == nil {
		return
	}
	allowed := mainlineNodeSet(g.MainlineAnalysisInputs())
	for nodeID, result := range analysis {
		if !allowed[nodeID] {
			continue
		}
		w.analysis[analysisCacheKey(gameID, nodeID)] = cloneAnalysisResult(result)
	}
	if w.analysisCompleteLocked(gameID) {
		w.analysisState[gameID] = AnalysisComplete
	}
}

func (w *Workspace) MainlineAnalysis(gameID string) (map[string]game.AnalysisResult, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	g, err := w.game(gameID)
	if err != nil {
		return nil, err
	}
	out := map[string]game.AnalysisResult{}
	for _, node := range g.MainlineAnalysisInputs() {
		if analysis, ok := w.analysis[analysisCacheKey(gameID, node.NodeID)]; ok {
			out[node.NodeID] = cloneAnalysisResult(analysis)
		}
	}
	return out, nil
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
	return snapshot, err
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
	snapshot := g.CurrentSnapshot()
	return &snapshot, nil
}

func (w *Workspace) AnalysisView(gameID string) ([]game.ChartPoint, []game.BadMove, AnalysisState, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.analysisViewLocked(gameID)
}

func (w *Workspace) analysisViewLocked(gameID string) ([]game.ChartPoint, []game.BadMove, AnalysisState, error) {
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
			Winrate:    analysis.Root.Winrate,
			ScoreLead:  analysis.Root.ScoreLead,
		})
		if hasPreviousAnalysis && node.Move != "" {
			pointsLost := playedMovePointLoss(node.MoveColor, previousAnalysis.Root.ScoreLead, analysis.Root.ScoreLead)
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

func (w *Workspace) MissingMainlineAnalysisInputs(gameID string) []NodeInput {
	w.mu.Lock()
	defer w.mu.Unlock()
	g := w.games[gameID]
	if g == nil {
		return nil
	}
	inputs := g.MainlineAnalysisInputs()
	missing := make([]NodeInput, 0, len(inputs))
	for _, input := range inputs {
		if _, ok := w.analysis[analysisCacheKey(gameID, input.NodeID)]; !ok {
			missing = append(missing, input)
		}
	}
	return missing
}

func (w *Workspace) CurrentAnalysisInput(gameID string) (NodeInput, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	g := w.games[gameID]
	if g == nil {
		return NodeInput{}, false
	}
	return g.CurrentAnalysisInput()
}

func (w *Workspace) game(gameID string) (*game.Game, error) {
	g := w.games[gameID]
	if g == nil {
		return nil, fmt.Errorf("game %s not loaded", gameID)
	}
	return g, nil
}

func (w *Workspace) clearAnalysisLocked(gameID string) {
	prefix := gameID + ":"
	for key := range w.analysis {
		if strings.HasPrefix(key, prefix) {
			delete(w.analysis, key)
		}
	}
}

func (w *Workspace) clearVariationAnalysisLocked(gameID string) {
	prefix := analysisCacheKey(gameID, "var:")
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

func mainlineNodeSet(inputs []NodeInput) map[string]bool {
	allowed := make(map[string]bool, len(inputs))
	for _, input := range inputs {
		allowed[input.NodeID] = true
	}
	return allowed
}

func cloneAnalysisResult(in game.AnalysisResult) game.AnalysisResult {
	out := game.AnalysisResult{
		Root:        in.Root,
		Candidates:  make([]game.CandidateRaw, len(in.Candidates)),
		OwnershipQ8: append([]byte(nil), in.OwnershipQ8...),
		Policy:      append([]float64(nil), in.Policy...),
	}
	for i, candidate := range in.Candidates {
		out.Candidates[i] = candidate
		out.Candidates[i].PV = append([]string(nil), candidate.PV...)
	}
	return out
}
