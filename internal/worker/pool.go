package worker

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"
	"sync/atomic"

	"github.com/gorilla/websocket"

	"jcgo/internal/katago"
)

type Pool struct {
	fallback katago.Analyzer
	logger   *log.Logger

	seq uint64
	mu  sync.Mutex
	ws  map[string]*remoteWorker
}

type remoteWorker struct {
	id        string
	info      Info
	conn      *websocket.Conn
	writeMu   sync.Mutex
	busy      bool
	closed    bool
	responses map[string]chan Envelope
}

func NewPool(fallback katago.Analyzer, logger *log.Logger) *Pool {
	if logger == nil {
		logger = log.Default()
	}
	return &Pool{
		fallback: fallback,
		logger:   logger,
		ws:       map[string]*remoteWorker{},
	}
}

func (p *Pool) Analyze(ctx context.Context, query katago.Query) (katago.Result, error) {
	return p.AnalyzeWithProgress(ctx, query, nil)
}

func (p *Pool) AnalyzeWithProgress(ctx context.Context, query katago.Query, progress func(katago.Result)) (katago.Result, error) {
	worker := p.pickWorker()
	if worker == nil {
		p.logger.Printf("worker pool: no idle remote worker, using local analyzer for query %s", query.ID)
		return p.analyzeFallback(ctx, query, progress)
	}

	result, err := p.analyzeRemote(ctx, worker, query, progress)
	p.releaseWorker(worker)
	if err == nil {
		return result, nil
	}
	p.logger.Printf("worker pool: remote worker %s failed query %s: %v; using local analyzer", worker.info.Name, query.ID, err)
	return p.analyzeFallback(ctx, query, progress)
}

func (p *Pool) Available() bool {
	p.mu.Lock()
	for _, worker := range p.ws {
		if !worker.closed && worker.info.Available {
			p.mu.Unlock()
			return true
		}
	}
	p.mu.Unlock()
	return p.fallback.Available()
}

func (p *Pool) Status() katago.Status {
	if p.Available() {
		return katago.Status{Available: true}
	}
	return p.fallback.Status()
}

func (p *Pool) Close() error {
	p.mu.Lock()
	workers := make([]*remoteWorker, 0, len(p.ws))
	for _, worker := range p.ws {
		workers = append(workers, worker)
	}
	p.mu.Unlock()
	for _, worker := range workers {
		_ = worker.conn.Close()
	}
	return p.fallback.Close()
}

func (p *Pool) ServeWS(conn *websocket.Conn) {
	defer conn.Close()

	var register Envelope
	if err := conn.ReadJSON(&register); err != nil {
		p.logger.Printf("worker pool: failed to read register message: %v", err)
		return
	}
	if register.Type != MessageRegister || register.Worker == nil {
		p.logger.Printf("worker pool: rejected connection without register message")
		return
	}

	id := fmt.Sprintf("worker-%d", atomic.AddUint64(&p.seq, 1))
	worker := &remoteWorker{
		id:        id,
		info:      *register.Worker,
		conn:      conn,
		responses: map[string]chan Envelope{},
	}
	p.addWorker(worker)
	defer p.removeWorker(id)

	for {
		var msg Envelope
		if err := conn.ReadJSON(&msg); err != nil {
			p.logger.Printf("worker pool: worker %s disconnected: %v", worker.info.Name, err)
			return
		}
		p.deliver(worker, msg)
	}
}

func (p *Pool) ServeWorkerWS(conn *websocket.Conn) {
	p.ServeWS(conn)
}

func (p *Pool) WorkerCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.ws)
}

func (p *Pool) addWorker(worker *remoteWorker) {
	p.mu.Lock()
	p.ws[worker.id] = worker
	p.mu.Unlock()
	p.logger.Printf("worker pool: registered %s platform=%s katago=%s model=%s config=%s available=%t error=%s",
		worker.info.Name, worker.info.Platform, worker.info.KatagoPath, worker.info.ModelPath, worker.info.AnalysisConfigPath, worker.info.Available, worker.info.Error)
}

func (p *Pool) removeWorker(id string) {
	p.mu.Lock()
	worker, ok := p.ws[id]
	if ok {
		worker.closed = true
		for _, ch := range worker.responses {
			close(ch)
		}
		delete(p.ws, id)
	}
	p.mu.Unlock()
	if ok {
		p.logger.Printf("worker pool: removed %s", worker.info.Name)
	}
}

func (p *Pool) pickWorker() *remoteWorker {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, worker := range p.ws {
		if !worker.closed && !worker.busy && worker.info.Available {
			worker.busy = true
			return worker
		}
	}
	return nil
}

func (p *Pool) releaseWorker(worker *remoteWorker) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if current, ok := p.ws[worker.id]; ok {
		current.busy = false
	}
}

func (p *Pool) analyzeRemote(ctx context.Context, worker *remoteWorker, query katago.Query, progress func(katago.Result)) (katago.Result, error) {
	id := fmt.Sprintf("job-%d", atomic.AddUint64(&p.seq, 1))
	ch := make(chan Envelope, 8)

	p.mu.Lock()
	if worker.closed {
		p.mu.Unlock()
		return katago.Result{}, errors.New("worker disconnected")
	}
	worker.responses[id] = ch
	p.mu.Unlock()
	defer func() {
		p.mu.Lock()
		delete(worker.responses, id)
		p.mu.Unlock()
	}()

	worker.writeMu.Lock()
	err := worker.conn.WriteJSON(Envelope{Type: MessageAnalyze, ID: id, Query: &query})
	worker.writeMu.Unlock()
	if err != nil {
		return katago.Result{}, err
	}

	for {
		select {
		case <-ctx.Done():
			return katago.Result{}, ctx.Err()
		case msg, ok := <-ch:
			if !ok {
				return katago.Result{}, errors.New("worker disconnected")
			}
			if msg.Type == MessageError {
				if msg.Error == "" {
					msg.Error = "worker returned error"
				}
				return katago.Result{}, errors.New(msg.Error)
			}
			if msg.Type != MessageResult || msg.Result == nil {
				return katago.Result{}, fmt.Errorf("unexpected worker message %q", msg.Type)
			}
			if msg.Result.IsDuringSearch {
				if progress != nil {
					progress(*msg.Result)
				}
				continue
			}
			return *msg.Result, nil
		}
	}
}

func (p *Pool) deliver(worker *remoteWorker, msg Envelope) {
	p.mu.Lock()
	ch := worker.responses[msg.ID]
	p.mu.Unlock()
	if ch == nil {
		p.logger.Printf("worker pool: ignoring response with unknown id %s from %s", msg.ID, worker.info.Name)
		return
	}
	ch <- msg
}

func (p *Pool) analyzeFallback(ctx context.Context, query katago.Query, progress func(katago.Result)) (katago.Result, error) {
	if engine, ok := p.fallback.(katago.ProgressAnalyzer); ok {
		return engine.AnalyzeWithProgress(ctx, query, progress)
	}
	return p.fallback.Analyze(ctx, query)
}
