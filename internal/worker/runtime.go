package worker

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"jcgo/internal/config"
	"jcgo/internal/katago"
)

const (
	defaultRuntimeModel     = "kata1-b18c384nbt-s9996604416-d4316597426.bin.gz"
	defaultRuntimeMaxVisits = 500
)

type RuntimeConfig struct {
	Model     string `json:"model"`
	MaxVisits int    `json:"maxVisits"`
}

type HardwareInfo struct {
	CPU  string
	GPUs []string
}

type RuntimeOptions struct {
	Context       context.Context
	Dir           string
	Logger        *log.Logger
	StartLocal    func(context.Context, string, string, string) (katago.Analyzer, error)
	ProbeHardware func(context.Context) HardwareInfo
}

type Runtime struct {
	mu           sync.Mutex
	stateMu      sync.RWMutex
	statusEngine katago.Analyzer
	ctx          context.Context
	cancel       context.CancelFunc
	dir          string
	logger       *log.Logger
	startLocal   func(context.Context, string, string, string) (katago.Analyzer, error)
	engine       katago.Analyzer
	cfg          config.Config
	backend      config.KatagoBackendInfo
	hardware     HardwareInfo
	currentModel string
}

func NewRuntime(opts RuntimeOptions) (*Runtime, error) {
	if opts.Context == nil {
		opts.Context = context.Background()
	}
	ctx, cancelRuntime := context.WithCancel(opts.Context)
	if opts.Logger == nil {
		opts.Logger = log.Default()
	}
	if opts.StartLocal == nil {
		opts.StartLocal = katago.StartLocal
	}
	if opts.ProbeHardware == nil {
		opts.ProbeHardware = DetectHardware
	}
	cfg, err := config.LoadDir(opts.Dir)
	if err != nil {
		cancelRuntime()
		return nil, err
	}
	applyRuntimeDefaults(&cfg)
	probeCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	hardware := opts.ProbeHardware(probeCtx)
	cancel()
	r := &Runtime{
		ctx: ctx, cancel: cancelRuntime,
		dir:          cfg.Dir,
		logger:       opts.Logger,
		startLocal:   opts.StartLocal,
		cfg:          cfg,
		backend:      config.LoadKatagoBackendInfo(cfg.Dir),
		hardware:     hardware,
		currentModel: cfg.Worker.Model,
	}
	r.mu.Lock()
	err = r.startLocked(ctx)
	r.mu.Unlock()
	if err != nil {
		r.logger.Printf("katago unavailable: %v", err)
	}
	return r, nil
}

func (r *Runtime) Info() Info {
	r.stateMu.RLock()
	engine := r.statusEngine
	r.stateMu.RUnlock()
	status := katago.Status{Error: "katago is initializing"}
	if engine != nil {
		status = engine.Status()
	}
	return Info{Name: r.cfg.Worker.Name, Platform: runtime.GOOS + "/" + runtime.GOARCH, Backend: r.backend.ID, CPU: r.hardware.CPU, GPUs: append([]string{}, r.hardware.GPUs...), Error: status.Error}
}

func (r *Runtime) Analyze(ctx context.Context, query katago.Query, cfg RuntimeConfig) (katago.Result, error) {
	ctx, cancel := r.analysisContext(ctx)
	defer cancel()
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return katago.Result{}, err
	}
	cfg = normalizeRuntimeConfig(cfg)
	if err := r.ensureModelLocked(ctx, cfg.Model); err != nil {
		return katago.Result{}, err
	}
	query.MaxVisits = cfg.MaxVisits
	return r.engine.Analyze(ctx, query)
}

func (r *Runtime) AnalyzeWithProgress(ctx context.Context, query katago.Query, cfg RuntimeConfig, progress func(katago.Result)) (katago.Result, error) {
	ctx, cancel := r.analysisContext(ctx)
	defer cancel()
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return katago.Result{}, err
	}
	cfg = normalizeRuntimeConfig(cfg)
	if err := r.ensureModelLocked(ctx, cfg.Model); err != nil {
		return katago.Result{}, err
	}
	query.MaxVisits = cfg.MaxVisits
	if progressEngine, ok := r.engine.(katago.ProgressAnalyzer); ok {
		return progressEngine.AnalyzeWithProgress(ctx, query, progress)
	}
	return r.engine.Analyze(ctx, query)
}

func (r *Runtime) Close() error {
	r.cancel()
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.engine == nil {
		return nil
	}
	return r.engine.Close()
}

func (r *Runtime) analysisContext(ctx context.Context) (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(r.ctx, cancel)
	if r.ctx.Err() != nil {
		cancel()
	}
	return ctx, func() { stop(); cancel() }
}

func (r *Runtime) ensureModelLocked(ctx context.Context, model string) error {
	if model == "" {
		return errors.New("model is required")
	}
	modelPath := filepath.Join(r.cfg.Dir, "model", model)
	if _, err := os.Stat(modelPath); err != nil {
		return fmt.Errorf("model %s is unavailable: %w", model, err)
	}
	if r.currentModel == model && r.engine != nil && r.engine.Available() {
		return nil
	}
	if r.engine != nil {
		_ = r.engine.Close()
	}
	r.currentModel = model
	r.cfg.Worker.Model = model
	r.cfg.ModelPath = modelPath
	return r.startLocked(r.ctx)
}

func (r *Runtime) startLocked(ctx context.Context) error {
	engine, err := r.startLocal(ctx, r.cfg.KatagoPath, r.cfg.ModelPath, r.cfg.AnalysisConfigPath)
	if err != nil {
		r.engine = katago.NewUnavailable(err.Error())
		r.stateMu.Lock()
		r.statusEngine = r.engine
		r.stateMu.Unlock()
		return err
	}
	r.engine = engine
	r.stateMu.Lock()
	r.statusEngine = engine
	r.stateMu.Unlock()
	return nil
}

func applyRuntimeDefaults(cfg *config.Config) {
	cfg.Worker.Model = defaultRuntimeModel
	cfg.ModelPath = filepath.Join(cfg.Dir, "model", cfg.Worker.Model)
}

func defaultRuntimeConfig() RuntimeConfig {
	return RuntimeConfig{Model: defaultRuntimeModel, MaxVisits: defaultRuntimeMaxVisits}
}

func normalizeRuntimeConfig(cfg RuntimeConfig) RuntimeConfig {
	if cfg.Model == "" {
		cfg.Model = defaultRuntimeModel
	}
	if cfg.MaxVisits <= 0 {
		cfg.MaxVisits = defaultRuntimeMaxVisits
	}
	return cfg
}
