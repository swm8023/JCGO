package app

import (
	"context"
	"errors"
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
	localEngine, err := startEngine(ctx, cfg)
	if err != nil {
		localEngine = katago.NewUnavailable(err.Error())
	}
	workers := worker.NewPool(localEngine, log.Default())
	engine := katago.Analyzer(workers)
	workspaces := NewWorkspaceStore()
	scheduler := NewScheduler(engine, cfg.MaxVisits)
	handler := NewHandlerWithOptions(repo, files, workspaces, scheduler, HandlerOptions{
		YuanluoboAuthStore:   NewYuanluoboFileAuthStore(filepath.Join(cfg.DataDir, "yuanluobo_auth.json")),
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

func (a *App) EngineStatus() katago.Status {
	return a.Engine.Status()
}

func (a *App) Close() error {
	_ = a.Scheduler.Close()
	return a.Repo.Close()
}

func startEngine(ctx context.Context, cfg config.Config) (katago.Analyzer, error) {
	if cfg.KatagoPath == "" || cfg.ModelPath == "" || cfg.AnalysisConfigPath == "" {
		return nil, errors.New("katago path, model path, and analysis config path are required for analysis")
	}
	return katago.StartLocal(ctx, cfg.KatagoPath, cfg.ModelPath, cfg.AnalysisConfigPath)
}
