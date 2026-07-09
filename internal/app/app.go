package app

import (
	"context"
	"log"
	"path/filepath"

	"jcgo/internal/config"
	"jcgo/internal/katago"
	"jcgo/internal/store"
	"jcgo/internal/worker"
)

type App struct {
	Repo       *store.Repository
	Files      store.FileStore
	Workspaces *WorkspaceStore
	Engine     katago.Analyzer
	Workers    *worker.Pool
	Scheduler  *Scheduler
	RPC        *Handler
}

func New(ctx context.Context, cfg config.Config) (*App, error) {
	repo, err := store.Open(ctx, cfg.DatabasePath)
	if err != nil {
		return nil, err
	}
	files := store.NewFileStore(cfg.GamesDir)
	workers := worker.NewPool(log.Default())
	workers.SetConfigProvider(workerConfigProvider{repo: repo})
	engine := katago.Analyzer(workers)
	workspaces := NewWorkspaceStore()
	scheduler := NewScheduler(engine)
	handler := NewHandlerWithOptions(repo, files, workspaces, scheduler, HandlerOptions{
		YuanluoboAuthStore:   NewYuanluoboFileAuthStore(filepath.Join(cfg.Dir, "config", "yuanluobo_auth.json")),
		WorkerStatusProvider: workers,
	})
	return &App{
		Repo:       repo,
		Files:      files,
		Workspaces: workspaces,
		Engine:     engine,
		Workers:    workers,
		Scheduler:  scheduler,
		RPC:        handler,
	}, nil
}

type workerConfigProvider struct {
	repo *store.Repository
}

func (p workerConfigProvider) RuntimeConfig(ctx context.Context, workerName string) (worker.RuntimeConfig, error) {
	cfg, err := p.repo.GetOrCreateWorkerConfig(ctx, workerName)
	if err != nil {
		return worker.RuntimeConfig{}, err
	}
	return worker.RuntimeConfig{Model: cfg.Model, MaxVisits: cfg.MaxVisits}, nil
}

func (a *App) EngineStatus() katago.Status {
	return a.Engine.Status()
}

func (a *App) Close() error {
	_ = a.Scheduler.Close()
	return a.Repo.Close()
}
