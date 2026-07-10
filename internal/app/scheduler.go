package app

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"

	"jcgo/internal/game"
	"jcgo/internal/katago"
)

type NodeInput = game.AnalysisInput

type StartInput struct {
	Token       string
	GameID      string
	DisplayName string
	FocusNodeID string
	WorkerName  string
	Nodes       []NodeInput
}

type ScheduleSnapshot struct {
	Lanes []WorkerLaneSnapshot `json:"lanes"`
}

type WorkerLaneSnapshot struct {
	WorkerName   string                 `json:"workerName"`
	Current      *ScheduleTaskSnapshot  `json:"current,omitempty"`
	HighPriority []ScheduleTaskSnapshot `json:"highPriority"`
	Queue        []ScheduleTaskSnapshot `json:"queue"`
}

type ScheduleTaskSnapshot struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	GameID      string `json:"gameId"`
	DisplayName string `json:"displayName"`
	NodeID      string `json:"nodeId,omitempty"`
	MoveNumber  int    `json:"moveNumber,omitempty"`
	WorkerName  string `json:"workerName"`
	Analyzed    int    `json:"analyzed"`
	Total       int    `json:"total"`
	Status      string `json:"status"`
	CanBoost    bool   `json:"canBoost"`
}

const (
	scheduleTaskBackground = "background"
	scheduleTaskTrial      = "trial"
	scheduleStatusQueued   = "queued"
	scheduleStatusRunning  = "running"
)

type Event struct {
	Token          string              `json:"-"`
	GameID         string              `json:"gameId"`
	NodeID         string              `json:"nodeId"`
	MoveNumber     int                 `json:"moveNumber"`
	Analysis       game.AnalysisResult `json:"analysis"`
	Error          string              `json:"error,omitempty"`
	IsDuringSearch bool                `json:"isDuringSearch,omitempty"`
}

type Subscriber func(Event)

type Scheduler struct {
	engine      katago.Analyzer
	closed      chan struct{}
	closeOnce   sync.Once
	mu          sync.Mutex
	runs        map[string]*analysisRun
	lanes       map[string]*workerLane
	subscribers map[int]Subscriber
	nextSubID   int
	nextRunID   uint64
}

type workerLane struct {
	workerName   string
	wake         chan struct{}
	running      bool
	current      *scheduledNode
	activeRun    *analysisRun
	highPriority []*scheduledNode
	queue        []*analysisRun
}

type analysisRun struct {
	id          string
	token       string
	gameID      string
	displayName string
	workerName  string
	generation  uint64
	nodes       []NodeInput
	nextIndex   int
	analyzed    int
	stopped     bool
	cancel      context.CancelFunc
}

type scheduledNode struct {
	id          string
	kind        string
	token       string
	gameID      string
	displayName string
	workerName  string
	generation  uint64
	node        NodeInput
	run         *analysisRun
	cancel      context.CancelFunc
}

type task struct {
	token      string
	gameID     string
	workerName string
	generation uint64
	node       NodeInput
}

type workerAnalyzer interface {
	AnalyzeWithWorker(context.Context, string, katago.Query) (katago.Result, error)
}

type workerProgressAnalyzer interface {
	AnalyzeWithWorkerProgress(context.Context, string, katago.Query, func(katago.Result)) (katago.Result, error)
}

func NewScheduler(engine katago.Analyzer) *Scheduler {
	return &Scheduler{
		engine:      engine,
		closed:      make(chan struct{}),
		runs:        map[string]*analysisRun{},
		lanes:       map[string]*workerLane{},
		subscribers: map[int]Subscriber{},
	}
}

func (s *Scheduler) Subscribe(subscriber Subscriber) func() {
	s.mu.Lock()
	s.nextSubID++
	id := s.nextSubID
	s.subscribers[id] = subscriber
	s.mu.Unlock()
	return func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		delete(s.subscribers, id)
	}
}

func (s *Scheduler) StartGame(input StartInput) {
	ordered := orderFocusFirst(input.Nodes, input.FocusNodeID)
	key := analysisKey(input.Token, input.GameID)
	var oldCancel context.CancelFunc

	s.mu.Lock()
	if existing := s.runs[key]; existing != nil {
		oldCancel = existing.cancel
		existing.cancel = nil
		existing.stopped = true
		existing.generation++
		s.removeRunFromLaneLocked(existing)
	}
	if len(ordered) == 0 {
		delete(s.runs, key)
		s.mu.Unlock()
		if oldCancel != nil {
			oldCancel()
		}
		return
	}
	s.nextRunID++
	run := &analysisRun{
		id:          fmt.Sprintf("run-%d", s.nextRunID),
		token:       input.Token,
		gameID:      input.GameID,
		displayName: input.DisplayName,
		workerName:  input.WorkerName,
		generation:  1,
		nodes:       ordered,
	}
	s.runs[key] = run
	lane := s.laneForLocked(input.WorkerName)
	lane.queue = append(lane.queue, run)
	s.ensureLaneRunner(lane)
	s.wakeLane(lane)
	s.mu.Unlock()

	if oldCancel != nil {
		oldCancel()
	}
}

func (s *Scheduler) RestartGame(input StartInput) {
	s.StopGame(input.Token, input.GameID)
	s.StartGame(input)
}

func (s *Scheduler) AnalyzeNow(input StartInput) {
	if len(input.Nodes) == 0 {
		return
	}
	node := input.Nodes[0]
	s.mu.Lock()
	s.nextRunID++
	task := &scheduledNode{
		id:          fmt.Sprintf("trial-%d", s.nextRunID),
		kind:        scheduleTaskTrial,
		token:       input.Token,
		gameID:      input.GameID,
		displayName: input.DisplayName,
		workerName:  input.WorkerName,
		generation:  1,
		node:        node,
	}
	lane := s.laneForLocked(input.WorkerName)
	lane.highPriority = append(lane.highPriority, task)
	s.ensureLaneRunner(lane)
	s.wakeLane(lane)
	s.mu.Unlock()
}

func (s *Scheduler) StopGame(token, gameID string) {
	s.stopRun(token, gameID)
}

func (s *Scheduler) BoostGame(token, gameID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	run := s.runs[analysisKey(token, gameID)]
	if run == nil || run.stopped {
		return false
	}
	lane := s.lanes[run.workerName]
	if lane == nil || lane.activeRun == run {
		return false
	}
	for index, queued := range lane.queue {
		if queued != run {
			continue
		}
		if index == 0 {
			return true
		}
		lane.queue = append(lane.queue[:index], lane.queue[index+1:]...)
		lane.queue = append([]*analysisRun{run}, lane.queue...)
		s.wakeLane(lane)
		return true
	}
	return false
}

func (s *Scheduler) Snapshot() ScheduleSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()

	names := make([]string, 0, len(s.lanes))
	for name := range s.lanes {
		names = append(names, name)
	}
	sort.Strings(names)

	lanes := make([]WorkerLaneSnapshot, 0, len(names))
	for _, name := range names {
		lane := s.lanes[name]
		item := WorkerLaneSnapshot{
			WorkerName:   name,
			HighPriority: []ScheduleTaskSnapshot{},
			Queue:        []ScheduleTaskSnapshot{},
		}
		if lane.current != nil {
			current := scheduleSnapshotForTask(*lane.current, scheduleStatusRunning, false)
			item.Current = &current
		}
		for _, task := range lane.highPriority {
			item.HighPriority = append(item.HighPriority, scheduleSnapshotForTask(*task, scheduleStatusQueued, false))
		}
		for index, run := range lane.queue {
			if run.stopped || run.nextIndex >= len(run.nodes) {
				continue
			}
			item.Queue = append(item.Queue, scheduleSnapshotForRun(run, index > 0))
		}
		lanes = append(lanes, item)
	}
	return ScheduleSnapshot{Lanes: lanes}
}

func (s *Scheduler) Status() katago.Status {
	return s.engine.Status()
}

func (s *Scheduler) Close() error {
	s.closeOnce.Do(func() {
		s.cancelAllRuns()
		close(s.closed)
	})
	return s.engine.Close()
}

func (s *Scheduler) laneForLocked(workerName string) *workerLane {
	lane := s.lanes[workerName]
	if lane != nil {
		return lane
	}
	lane = &workerLane{
		workerName:   workerName,
		wake:         make(chan struct{}, 1),
		highPriority: []*scheduledNode{},
		queue:        []*analysisRun{},
	}
	s.lanes[workerName] = lane
	return lane
}

func (s *Scheduler) wakeLane(lane *workerLane) {
	select {
	case lane.wake <- struct{}{}:
	default:
	}
}

func (s *Scheduler) ensureLaneRunner(lane *workerLane) {
	if lane.running {
		return
	}
	lane.running = true
	go s.runLane(lane.workerName)
}

func (s *Scheduler) runLane(workerName string) {
	defer func() {
		s.mu.Lock()
		if lane := s.lanes[workerName]; lane != nil {
			lane.running = false
		}
		s.mu.Unlock()
	}()
	for {
		task, ok := s.nextLaneTask(workerName)
		if !ok {
			return
		}
		s.executeScheduledNode(task)
	}
}

func (s *Scheduler) nextLaneTask(workerName string) (scheduledNode, bool) {
	for {
		s.mu.Lock()
		lane := s.lanes[workerName]
		if lane == nil {
			s.mu.Unlock()
			return scheduledNode{}, false
		}
		if len(lane.highPriority) > 0 {
			task := lane.highPriority[0]
			lane.highPriority = lane.highPriority[1:]
			lane.current = task
			s.mu.Unlock()
			return *task, true
		}
		for {
			run := lane.activeRun
			if run == nil {
				if len(lane.queue) == 0 {
					break
				}
				run = lane.queue[0]
				lane.queue = lane.queue[1:]
				lane.activeRun = run
			}
			if run.stopped || run.nextIndex >= len(run.nodes) {
				lane.activeRun = nil
				continue
			}
			task := &scheduledNode{
				id:          run.id + ":" + run.nodes[run.nextIndex].NodeID,
				kind:        scheduleTaskBackground,
				token:       run.token,
				gameID:      run.gameID,
				displayName: run.displayName,
				workerName:  run.workerName,
				generation:  run.generation,
				node:        run.nodes[run.nextIndex],
				run:         run,
			}
			lane.current = task
			s.mu.Unlock()
			return *task, true
		}
		lane.current = nil
		wake := lane.wake
		s.mu.Unlock()

		select {
		case <-s.closed:
			return scheduledNode{}, false
		case <-wake:
			continue
		}
	}
}

func (s *Scheduler) executeScheduledNode(task scheduledNode) {
	query := katago.BuildQuery(katago.BuildInput{
		ID:            task.node.NodeID,
		Rules:         task.node.Rules,
		Komi:          task.node.Komi,
		InitialStones: task.node.InitialStones,
		InitialPlayer: string(task.node.InitialPlayer),
		Moves:         task.node.Moves,
		AnalyzeTurn:   task.node.MoveNumber,
	})
	ctx, cancel := context.WithCancel(context.Background())
	s.setTaskCancel(task, cancel)
	result, err := s.analyze(ctx, task.toLegacyTask(), query)
	s.finishScheduledNode(task, cancel, result, err)
}

func (scheduled scheduledNode) toLegacyTask() task {
	return task{
		token:      scheduled.token,
		gameID:     scheduled.gameID,
		workerName: scheduled.workerName,
		generation: scheduled.generation,
		node:       scheduled.node,
	}
}

func (s *Scheduler) analyze(ctx context.Context, task task, query katago.Query) (katago.Result, error) {
	if task.workerName != "" {
		if engine, ok := s.engine.(workerProgressAnalyzer); ok {
			return engine.AnalyzeWithWorkerProgress(ctx, task.workerName, query, func(result katago.Result) {
				if !s.isTaskActive(task) {
					return
				}
				s.publishAnalysis(task, result)
			})
		}
		if engine, ok := s.engine.(workerAnalyzer); ok {
			return engine.AnalyzeWithWorker(ctx, task.workerName, query)
		}
		return katago.Result{}, fmt.Errorf("analysis worker %s is not supported by analyzer", task.workerName)
	}
	if engine, ok := s.engine.(katago.ProgressAnalyzer); ok {
		return engine.AnalyzeWithProgress(ctx, query, func(result katago.Result) {
			if !s.isTaskActive(task) {
				return
			}
			s.publishAnalysis(task, result)
		})
	}
	return s.engine.Analyze(ctx, query)
}

func (s *Scheduler) setTaskCancel(task scheduledNode, cancel context.CancelFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	lane := s.lanes[task.workerName]
	if lane != nil && lane.current != nil && lane.current.id == task.id {
		lane.current.cancel = cancel
	}
	if task.kind == scheduleTaskBackground && task.run != nil && task.run.generation == task.generation && !task.run.stopped {
		task.run.cancel = cancel
	}
}

func (s *Scheduler) finishScheduledNode(task scheduledNode, cancel context.CancelFunc, result katago.Result, err error) {
	cancel()
	legacy := task.toLegacyTask()
	if err != nil {
		if errors.Is(err, context.Canceled) && !s.isScheduledTaskActive(task) {
			s.clearCurrentTask(task)
			return
		}
		if task.kind == scheduleTaskBackground {
			s.stopRun(task.token, task.gameID)
		}
		s.publishError(legacy, err)
		s.clearCurrentTask(task)
		return
	}
	if !s.isScheduledTaskActive(task) {
		s.clearCurrentTask(task)
		return
	}
	s.publishAnalysis(legacy, result)
	s.markTaskComplete(task)
	s.clearCurrentTask(task)
}

func (s *Scheduler) markTaskComplete(task scheduledNode) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if task.kind != scheduleTaskBackground || task.run == nil {
		return
	}
	run := s.runs[analysisKey(task.token, task.gameID)]
	if run == nil || run.generation != task.generation || run.stopped {
		return
	}
	run.cancel = nil
	run.nextIndex++
	run.analyzed++
	if run.nextIndex >= len(run.nodes) {
		run.stopped = true
		delete(s.runs, analysisKey(task.token, task.gameID))
		lane := s.lanes[task.workerName]
		if lane != nil && lane.activeRun == run {
			lane.activeRun = nil
		}
	}
}

func (s *Scheduler) isScheduledTaskActive(task scheduledNode) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if task.kind == scheduleTaskBackground {
		run := s.runs[analysisKey(task.token, task.gameID)]
		return run != nil && run.generation == task.generation && !run.stopped
	}
	lane := s.lanes[task.workerName]
	return lane != nil && lane.current != nil && lane.current.id == task.id
}

func (s *Scheduler) clearCurrentTask(task scheduledNode) {
	s.mu.Lock()
	defer s.mu.Unlock()
	lane := s.lanes[task.workerName]
	if lane != nil && lane.current != nil && lane.current.id == task.id {
		lane.current = nil
	}
}

func (s *Scheduler) removeRunFromLaneLocked(run *analysisRun) {
	lane := s.lanes[run.workerName]
	if lane == nil {
		return
	}
	if lane.activeRun == run {
		lane.activeRun = nil
	}
	for i, queued := range lane.queue {
		if queued == run {
			lane.queue = append(lane.queue[:i], lane.queue[i+1:]...)
			return
		}
	}
}

func (s *Scheduler) stopRun(token, gameID string) {
	key := analysisKey(token, gameID)
	var cancel context.CancelFunc
	s.mu.Lock()
	run := s.runs[key]
	if run != nil {
		run.stopped = true
		run.generation++
		cancel = run.cancel
		run.cancel = nil
		s.removeRunFromLaneLocked(run)
		delete(s.runs, key)
	}
	for _, lane := range s.lanes {
		lane.highPriority = removeQueuedGameTasks(lane.highPriority, token, gameID)
		if lane.current != nil && lane.current.token == token && lane.current.gameID == gameID && lane.current.cancel != nil {
			cancel = lane.current.cancel
		}
	}
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func removeQueuedGameTasks(tasks []*scheduledNode, token, gameID string) []*scheduledNode {
	kept := tasks[:0]
	for _, task := range tasks {
		if task.token == token && task.gameID == gameID {
			continue
		}
		kept = append(kept, task)
	}
	return kept
}

func (s *Scheduler) isTaskActive(task task) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	run := s.runs[analysisKey(task.token, task.gameID)]
	return run != nil && run.generation == task.generation && !run.stopped
}

func (s *Scheduler) cancelAllRuns() {
	s.mu.Lock()
	cancels := []context.CancelFunc{}
	for _, run := range s.runs {
		if run.cancel != nil {
			cancels = append(cancels, run.cancel)
			run.cancel = nil
		}
		run.stopped = true
		run.generation++
	}
	for _, lane := range s.lanes {
		if lane.current != nil && lane.current.cancel != nil {
			cancels = append(cancels, lane.current.cancel)
		}
		lane.current = nil
		lane.activeRun = nil
		lane.highPriority = nil
		lane.queue = nil
	}
	s.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
}

func (s *Scheduler) publishAnalysis(task task, result katago.Result) {
	s.publish(Event{
		Token:          task.token,
		GameID:         task.gameID,
		NodeID:         task.node.NodeID,
		MoveNumber:     task.node.MoveNumber,
		Analysis:       game.NormalizeAnalysis(task.node.ToPlay, result),
		IsDuringSearch: result.IsDuringSearch,
	})
}

func (s *Scheduler) publishError(task task, err error) {
	s.publish(Event{
		Token:      task.token,
		GameID:     task.gameID,
		NodeID:     task.node.NodeID,
		MoveNumber: task.node.MoveNumber,
		Error:      err.Error(),
	})
}

func (s *Scheduler) publish(event Event) {
	s.mu.Lock()
	subscribers := make([]Subscriber, 0, len(s.subscribers))
	for _, subscriber := range s.subscribers {
		subscribers = append(subscribers, subscriber)
	}
	s.mu.Unlock()
	for _, subscriber := range subscribers {
		subscriber(event)
	}
}

func scheduleSnapshotForRun(run *analysisRun, canBoost bool) ScheduleTaskSnapshot {
	nodeID := ""
	moveNumber := 0
	if run.nextIndex < len(run.nodes) {
		nodeID = run.nodes[run.nextIndex].NodeID
		moveNumber = run.nodes[run.nextIndex].MoveNumber
	}
	return ScheduleTaskSnapshot{
		ID:          run.id,
		Kind:        scheduleTaskBackground,
		GameID:      run.gameID,
		DisplayName: run.displayName,
		NodeID:      nodeID,
		MoveNumber:  moveNumber,
		WorkerName:  run.workerName,
		Analyzed:    run.analyzed,
		Total:       len(run.nodes),
		Status:      scheduleStatusQueued,
		CanBoost:    canBoost,
	}
}

func scheduleSnapshotForTask(task scheduledNode, status string, canBoost bool) ScheduleTaskSnapshot {
	total := 1
	analyzed := 0
	if task.kind == scheduleTaskBackground && task.run != nil {
		total = len(task.run.nodes)
		analyzed = task.run.analyzed
	}
	return ScheduleTaskSnapshot{
		ID:          task.id,
		Kind:        task.kind,
		GameID:      task.gameID,
		DisplayName: task.displayName,
		NodeID:      task.node.NodeID,
		MoveNumber:  task.node.MoveNumber,
		WorkerName:  task.workerName,
		Analyzed:    analyzed,
		Total:       total,
		Status:      status,
		CanBoost:    canBoost,
	}
}

func analysisKey(token, gameID string) string {
	return token + "\x00" + gameID
}

func orderFocusFirst(nodes []NodeInput, focusNodeID string) []NodeInput {
	ordered := append([]NodeInput(nil), nodes...)
	if focusNodeID == "" {
		return ordered
	}
	for i, node := range ordered {
		if node.NodeID == focusNodeID {
			copy(ordered[1:i+1], ordered[0:i])
			ordered[0] = node
			return ordered
		}
	}
	return ordered
}
