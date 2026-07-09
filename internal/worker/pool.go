package worker

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/gorilla/websocket"

	"jcgo/internal/katago"
)

type Pool struct {
	logger *log.Logger

	seq            uint64
	mu             sync.Mutex
	ws             map[string]*remoteWorker
	configProvider ConfigProvider
}

type ConfigProvider interface {
	RuntimeConfig(context.Context, string) (RuntimeConfig, error)
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

type RuntimeStatus struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Platform  string   `json:"platform"`
	Backend   string   `json:"backend,omitempty"`
	CPU       string   `json:"cpu,omitempty"`
	GPUs      []string `json:"gpus,omitempty"`
	Model     string   `json:"model,omitempty"`
	MaxVisits int      `json:"maxVisits,omitempty"`
	Available bool     `json:"available"`
	Busy      bool     `json:"busy"`
	Error     string   `json:"error,omitempty"`
}

type StatusSnapshot struct {
	Connected int             `json:"connected"`
	Available int             `json:"available"`
	Busy      int             `json:"busy"`
	Workers   []RuntimeStatus `json:"workers"`
}

func NewPool(logger *log.Logger) *Pool {
	if logger == nil {
		logger = log.Default()
	}
	return &Pool{
		logger: logger,
		ws:     map[string]*remoteWorker{},
	}
}

func (p *Pool) SetConfigProvider(provider ConfigProvider) {
	p.mu.Lock()
	p.configProvider = provider
	p.mu.Unlock()
}

func (p *Pool) Analyze(ctx context.Context, query katago.Query) (katago.Result, error) {
	return p.AnalyzeWithProgress(ctx, query, nil)
}

func (p *Pool) AnalyzeWithProgress(ctx context.Context, query katago.Query, progress func(katago.Result)) (katago.Result, error) {
	worker := p.pickWorker()
	if worker == nil {
		return katago.Result{}, errors.New("no available worker")
	}

	cfg, err := p.runtimeConfig(ctx, worker.info.Name)
	if err != nil {
		p.releaseWorker(worker)
		return katago.Result{}, err
	}

	result, err := p.analyzeRemote(ctx, worker, query, cfg, progress)
	p.releaseWorker(worker)
	if err == nil {
		return result, nil
	}
	p.logger.Printf("worker pool: remote worker %s failed query %s: %v", worker.info.Name, query.ID, err)
	return katago.Result{}, err
}

func (p *Pool) Available() bool {
	p.mu.Lock()
	for _, worker := range p.ws {
		if !worker.closed && workerAvailable(worker.info) {
			p.mu.Unlock()
			return true
		}
	}
	p.mu.Unlock()
	return false
}

func (p *Pool) Status() katago.Status {
	if p.Available() {
		return katago.Status{Available: true}
	}
	return katago.Status{Available: false, Error: "no available worker"}
}

func (p *Pool) StatusSnapshot() StatusSnapshot {
	p.mu.Lock()
	workers := make([]RuntimeStatus, 0, len(p.ws))
	status := StatusSnapshot{
		Connected: len(p.ws),
		Workers:   []RuntimeStatus{},
	}
	for id, worker := range p.ws {
		if worker.closed {
			continue
		}
		runtime := RuntimeStatus{
			ID:        id,
			Name:      worker.info.Name,
			Platform:  worker.info.Platform,
			Backend:   worker.info.Backend,
			CPU:       worker.info.CPU,
			GPUs:      append([]string{}, worker.info.GPUs...),
			Available: workerAvailable(worker.info),
			Busy:      worker.busy,
			Error:     worker.info.Error,
		}
		if runtime.Available {
			status.Available++
		}
		if runtime.Busy {
			status.Busy++
		}
		workers = append(workers, runtime)
	}
	p.mu.Unlock()

	sort.Slice(workers, func(i, j int) bool {
		return workers[i].ID < workers[j].ID
	})
	status.Workers = workers
	return status
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
	return nil
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
	p.logger.Printf("worker pool: registered %s platform=%s backend=%s cpu=%s gpus=%s error=%s",
		worker.info.Name, worker.info.Platform, worker.info.Backend, worker.info.CPU, strings.Join(worker.info.GPUs, ","), worker.info.Error)
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
		if !worker.closed && !worker.busy && workerAvailable(worker.info) {
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

func (p *Pool) analyzeRemote(ctx context.Context, worker *remoteWorker, query katago.Query, cfg RuntimeConfig, progress func(katago.Result)) (katago.Result, error) {
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
	err := worker.conn.WriteJSON(Envelope{Type: MessageAnalyze, ID: id, Query: &query, Config: &cfg})
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

func (p *Pool) runtimeConfig(ctx context.Context, workerName string) (RuntimeConfig, error) {
	p.mu.Lock()
	provider := p.configProvider
	p.mu.Unlock()
	if provider == nil {
		return defaultRuntimeConfig(), nil
	}
	cfg, err := provider.RuntimeConfig(ctx, workerName)
	if err != nil {
		return RuntimeConfig{}, err
	}
	return normalizeRuntimeConfig(cfg), nil
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

func workerAvailable(info Info) bool {
	return strings.TrimSpace(info.Error) == ""
}
