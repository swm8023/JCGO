package main

import (
	"context"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"jcgo/internal/katago"
	"jcgo/internal/worker"
)

type startLocalFunc func(context.Context, string, string, string) (katago.Analyzer, error)
type serveConnectionFunc func(context.Context, string, string, worker.Info, katago.Analyzer) error

type runOptions struct {
	Dir             string
	Logger          *log.Logger
	StartLocal      startLocalFunc
	ServeConnection serveConnectionFunc
	Sleep           func(time.Duration)
}

func main() {
	dir := executableDir()
	logFile, err := os.OpenFile(filepath.Join(dir, "jcgo-worker.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		log.Fatal(err)
	}
	defer logFile.Close()

	logger := log.New(io.MultiWriter(os.Stdout, logFile), "", log.LstdFlags)
	if err := run(context.Background(), runOptions{Dir: dir, Logger: logger}); err != nil {
		logger.Fatal(err)
	}
}

func run(ctx context.Context, opts runOptions) error {
	if opts.Dir == "" {
		opts.Dir = executableDir()
	}
	if opts.Logger == nil {
		opts.Logger = log.Default()
	}
	if opts.StartLocal == nil {
		opts.StartLocal = katago.StartLocal
	}
	if opts.ServeConnection == nil {
		opts.ServeConnection = worker.ServeConnection
	}
	if opts.Sleep == nil {
		opts.Sleep = time.Sleep
	}

	cfgPath := filepath.Join(opts.Dir, "jcgo-worker.json")
	cfg, created, err := worker.LoadOrCreateConfig(cfgPath)
	if err != nil {
		return err
	}
	if created {
		opts.Logger.Printf("created config template at %s; edit it and restart jcgo-worker.exe", cfgPath)
		return nil
	}
	if missing := cfg.MissingFields(); len(missing) > 0 {
		opts.Logger.Printf("config %s is missing required fields: %s", cfgPath, strings.Join(missing, ", "))
		return nil
	}

	engine, engineErr := opts.StartLocal(ctx, cfg.KatagoPath, cfg.ModelPath, cfg.AnalysisConfigPath)
	available := engineErr == nil
	errorMessage := ""
	if engineErr != nil {
		errorMessage = engineErr.Error()
		engine = katago.NewUnavailable(errorMessage)
		opts.Logger.Printf("katago unavailable: %v", engineErr)
	} else {
		defer engine.Close()
		opts.Logger.Printf("katago started: path=%s model=%s config=%s", cfg.KatagoPath, cfg.ModelPath, cfg.AnalysisConfigPath)
	}

	info := worker.Info{
		Name:               cfg.WorkerName,
		Platform:           runtime.GOOS + "/" + runtime.GOARCH,
		KatagoPath:         cfg.KatagoPath,
		ModelPath:          cfg.ModelPath,
		AnalysisConfigPath: cfg.AnalysisConfigPath,
		Available:          available,
		Error:              errorMessage,
	}

	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		opts.Logger.Printf("connecting to %s as %s", cfg.ServerURL, cfg.WorkerName)
		err := opts.ServeConnection(ctx, cfg.ServerURL, cfg.AccessToken, info, engine)
		opts.Logger.Printf("connection ended: %v", err)
		opts.Sleep(5 * time.Second)
	}
}

func executableDir() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	return filepath.Dir(exe)
}
