package main

import (
	"context"
	"errors"
	"flag"
	"io"
	"log"
	"os"
	"runtime"
	"strings"
	"time"

	"jcgo/internal/config"
	"jcgo/internal/katago"
	"jcgo/internal/worker"
)

type startLocalFunc func(context.Context, string, string, string) (katago.Analyzer, error)
type serveConnectionFunc func(context.Context, string, string, worker.Info, katago.Analyzer, int) error

type runOptions struct {
	Dir             string
	Logger          *log.Logger
	StartLocal      startLocalFunc
	ServeConnection serveConnectionFunc
	Sleep           func(time.Duration)
}

func main() {
	dirFlag := flag.String("dir", "", "JCGO home directory")
	_ = flag.CommandLine.Parse(os.Args[1:])
	dir := *dirFlag
	if dir == "" {
		var err error
		dir, err = config.DefaultDir()
		if err != nil {
			log.Fatal(err)
		}
	}
	cfg, err := config.LoadDir(dir)
	if err != nil {
		log.Fatal(err)
	}
	if err := config.EnsureDirs(cfg); err != nil {
		log.Fatal(err)
	}
	logFile, err := os.OpenFile(cfg.WorkerLogPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
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
		dir, err := config.DefaultDir()
		if err != nil {
			return err
		}
		opts.Dir = dir
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

	cfg, err := config.LoadDir(opts.Dir)
	if err != nil {
		return err
	}
	if !cfg.Worker.Enabled {
		opts.Logger.Printf("worker disabled in config")
		return nil
	}

	var engine katago.Analyzer
	available := false
	errorMessage := ""
	if strings.TrimSpace(cfg.Worker.Model) == "" {
		errorMessage = "worker.model is required"
		engine = katago.NewUnavailable(errorMessage)
	} else {
		started, engineErr := opts.StartLocal(ctx, cfg.KatagoPath, cfg.ModelPath, cfg.AnalysisConfigPath)
		if engineErr != nil {
			errorMessage = engineErr.Error()
			engine = katago.NewUnavailable(errorMessage)
			opts.Logger.Printf("katago unavailable: %v", engineErr)
		} else {
			engine = started
			available = true
			defer engine.Close()
			opts.Logger.Printf("katago started: path=%s model=%s config=%s", cfg.KatagoPath, cfg.ModelPath, cfg.AnalysisConfigPath)
		}
	}

	info := worker.Info{
		Name:               cfg.Worker.Name,
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
		opts.Logger.Printf("connecting to %s as %s", cfg.Worker.URL, cfg.Worker.Name)
		err := opts.ServeConnection(ctx, cfg.Worker.URL, cfg.Worker.Token, info, engine, cfg.Worker.MaxVisits)
		if errors.Is(err, context.Canceled) {
			return err
		}
		opts.Logger.Printf("connection ended: %v", err)
		opts.Sleep(5 * time.Second)
	}
}
