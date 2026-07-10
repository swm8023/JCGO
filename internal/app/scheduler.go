package app

import (
	"context"
	"fmt"
	"sync"

	"jcgo/internal/game"
	"jcgo/internal/katago"
)

type NodeInput = game.AnalysisInput

type StartInput struct {
	Token       string
	GameID      string
	FocusNodeID string
	WorkerName  string
	Nodes       []NodeInput
}

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
	tasks       chan task
	closed      chan struct{}
	closeOnce   sync.Once
	mu          sync.Mutex
	stopped     map[string]bool
	subscribers map[int]Subscriber
	nextSubID   int
}

type task struct {
	token      string
	gameID     string
	workerName string
	node       NodeInput
}

type workerAnalyzer interface {
	AnalyzeWithWorker(context.Context, string, katago.Query) (katago.Result, error)
}

type workerProgressAnalyzer interface {
	AnalyzeWithWorkerProgress(context.Context, string, katago.Query, func(katago.Result)) (katago.Result, error)
}

func NewScheduler(engine katago.Analyzer) *Scheduler {
	s := &Scheduler{
		engine:      engine,
		tasks:       make(chan task, 256),
		closed:      make(chan struct{}),
		stopped:     map[string]bool{},
		subscribers: map[int]Subscriber{},
	}
	go s.run()
	return s
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
	s.setStopped(input.Token, input.GameID, false)
	for _, node := range orderFocusFirst(input.Nodes, input.FocusNodeID) {
		s.enqueue(task{token: input.Token, gameID: input.GameID, workerName: input.WorkerName, node: node})
	}
}

func (s *Scheduler) RestartGame(input StartInput) {
	s.StopGame(input.Token, input.GameID)
	s.StartGame(input)
}

func (s *Scheduler) AnalyzeNow(input StartInput) {
	s.StartGame(input)
}

func (s *Scheduler) StopGame(token, gameID string) {
	s.setStopped(token, gameID, true)
}

func (s *Scheduler) Status() katago.Status {
	return s.engine.Status()
}

func (s *Scheduler) Close() error {
	s.closeOnce.Do(func() {
		close(s.closed)
	})
	return s.engine.Close()
}

func (s *Scheduler) run() {
	for {
		select {
		case <-s.closed:
			return
		case task := <-s.tasks:
			if s.isStopped(task.token, task.gameID) {
				continue
			}
			query := katago.BuildQuery(katago.BuildInput{
				ID:            task.node.NodeID,
				Rules:         task.node.Rules,
				Komi:          task.node.Komi,
				InitialStones: task.node.InitialStones,
				InitialPlayer: string(task.node.InitialPlayer),
				Moves:         task.node.Moves,
				AnalyzeTurn:   task.node.MoveNumber,
			})
			result, err := s.analyze(context.Background(), task, query)
			if err != nil {
				s.setStopped(task.token, task.gameID, true)
				s.publishError(task, err)
				continue
			}
			if s.isStopped(task.token, task.gameID) {
				continue
			}
			s.publishAnalysis(task, result)
		}
	}
}

func (s *Scheduler) analyze(ctx context.Context, task task, query katago.Query) (katago.Result, error) {
	if task.workerName != "" {
		if engine, ok := s.engine.(workerProgressAnalyzer); ok {
			return engine.AnalyzeWithWorkerProgress(ctx, task.workerName, query, func(result katago.Result) {
				if s.isStopped(task.token, task.gameID) {
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
			if s.isStopped(task.token, task.gameID) {
				return
			}
			s.publishAnalysis(task, result)
		})
	}
	return s.engine.Analyze(ctx, query)
}

func (s *Scheduler) enqueue(task task) {
	select {
	case s.tasks <- task:
	case <-s.closed:
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

func (s *Scheduler) setStopped(token, gameID string, stopped bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopped[analysisKey(token, gameID)] = stopped
}

func (s *Scheduler) isStopped(token, gameID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.stopped[analysisKey(token, gameID)]
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
