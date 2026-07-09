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

	"jcgo/internal/config"
	"jcgo/internal/katago"
)

const defaultRuntimeModel = "kata1-b18c384nbt-s9996604416-d4316597426.bin.gz"

type RuntimeConfig struct {
	Model     string `json:"model"`
	MaxVisits int    `json:"maxVisits"`
}

type RuntimeOptions struct {
	Dir        string
	Logger     *log.Logger
	StartLocal func(context.Context, string, string, string) (katago.Analyzer, error)
}

type Runtime struct {
	mu         sync.Mutex
	dir        string
	logger     *log.Logger
	startLocal func(context.Context, string, string, string) (katago.Analyzer, error)
	engine     katago.Analyzer
	cfg        config.Config
	backend    config.KatagoBackendInfo
}

func NewRuntime(opts RuntimeOptions) (*Runtime, error) {
	if opts.Logger == nil {
		opts.Logger = log.Default()
	}
	if opts.StartLocal == nil {
		opts.StartLocal = katago.StartLocal
	}
	cfg, err := config.LoadDir(opts.Dir)
	if err != nil {
		return nil, err
	}
	applyRuntimeDefaults(&cfg)
	r := &Runtime{
		dir:        cfg.Dir,
		logger:     opts.Logger,
		startLocal: opts.StartLocal,
		cfg:        cfg,
		backend:    config.LoadKatagoBackendInfo(cfg.Dir),
	}
	r.mu.Lock()
	err = r.startLocked(context.Background())
	r.mu.Unlock()
	if err != nil {
		r.logger.Printf("katago unavailable: %v", err)
	}
	return r, nil
}

func (r *Runtime) Info() Info {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.infoLocked()
}

func (r *Runtime) Analyze(ctx context.Context, query katago.Query) (katago.Result, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	query.MaxVisits = r.cfg.Worker.MaxVisits
	return r.engine.Analyze(ctx, query)
}

func (r *Runtime) AnalyzeWithProgress(ctx context.Context, query katago.Query, progress func(katago.Result)) (katago.Result, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	query.MaxVisits = r.cfg.Worker.MaxVisits
	if progressEngine, ok := r.engine.(katago.ProgressAnalyzer); ok {
		return progressEngine.AnalyzeWithProgress(ctx, query, progress)
	}
	return r.engine.Analyze(ctx, query)
}

func (r *Runtime) Configure(ctx context.Context, next RuntimeConfig) (Info, error) {
	if next.Model == "" {
		return r.Info(), errors.New("model is required")
	}
	if next.MaxVisits <= 0 {
		return r.Info(), errors.New("maxVisits must be positive")
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	modelPath := filepath.Join(r.cfg.Dir, "model", next.Model)
	if _, err := os.Stat(modelPath); err != nil {
		return r.infoLocked(), fmt.Errorf("model %s is unavailable: %w", next.Model, err)
	}
	previousModel := r.cfg.Worker.Model
	if err := config.UpdateWorkerRuntime(r.dir, next.Model, next.MaxVisits); err != nil {
		return r.infoLocked(), err
	}
	r.cfg.Worker.Model = next.Model
	r.cfg.Worker.MaxVisits = next.MaxVisits
	r.cfg.ModelPath = modelPath
	if previousModel != next.Model {
		if r.engine != nil {
			_ = r.engine.Close()
		}
		if err := r.startLocked(ctx); err != nil {
			return r.infoLocked(), err
		}
	}
	return r.infoLocked(), nil
}

func (r *Runtime) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.engine == nil {
		return nil
	}
	return r.engine.Close()
}

func (r *Runtime) infoLocked() Info {
	status := katago.Status{Available: false, Error: "katago is not initialized"}
	if r.engine != nil {
		status = r.engine.Status()
	}
	return Info{
		Name:               r.cfg.Worker.Name,
		Platform:           runtime.GOOS + "/" + runtime.GOARCH,
		KatagoPath:         r.cfg.KatagoPath,
		ModelPath:          r.cfg.ModelPath,
		AnalysisConfigPath: r.cfg.AnalysisConfigPath,
		Backend:            r.backend.ID,
		BackendLabel:       r.backend.Label,
		Model:              r.cfg.Worker.Model,
		MaxVisits:          r.cfg.Worker.MaxVisits,
		Available:          status.Available,
		Error:              status.Error,
	}
}

func (r *Runtime) startLocked(ctx context.Context) error {
	engine, err := r.startLocal(ctx, r.cfg.KatagoPath, r.cfg.ModelPath, r.cfg.AnalysisConfigPath)
	if err != nil {
		r.engine = katago.NewUnavailable(err.Error())
		return err
	}
	r.engine = engine
	return nil
}

func applyRuntimeDefaults(cfg *config.Config) {
	if cfg.Worker.Model == "" {
		cfg.Worker.Model = defaultRuntimeModel
		cfg.ModelPath = filepath.Join(cfg.Dir, "model", cfg.Worker.Model)
	}
}
