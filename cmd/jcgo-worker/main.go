package main

import (
	"context"
	"errors"
	"flag"
	"io"
	"log"
	"net/url"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"jcgo/internal/config"
	"jcgo/internal/katago"
	"jcgo/internal/managed"
	"jcgo/internal/worker"
)

type startLocalFunc func(context.Context, string, string, string) (katago.Analyzer, error)
type serveConnectionFunc func(context.Context, string, string, worker.ClientRuntime) error

type runOptions struct {
	Dir             string
	Logger          *log.Logger
	StartLocal      startLocalFunc
	ServeConnection serveConnectionFunc
	Sleep           func(time.Duration)
	Ready           func() error
	Health          *workerHealth
}

type workerHealth struct {
	mu              sync.RWMutex
	runtime         *worker.Runtime
	connected       bool
	connectionError string
	secrets         []string
}

func (s *workerHealth) snapshot() managed.Health {
	s.mu.RLock()
	engine := s.runtime
	connected := s.connected
	message := s.connectionError
	secrets := s.secrets
	s.mu.RUnlock()
	health := managed.Health{State: "healthy"}
	if !connected {
		if message == "" {
			message = "Connecting to server. Reconnecting automatically."
		}
		health.Components = append(health.Components, managed.Component{ID: "server", State: "reconnecting", Message: managed.Redact(message, secrets...)})
	}
	if engine != nil {
		info := engine.Info()
		if info.Error != "" {
			health.Components = append(health.Components, managed.Component{ID: "katago", State: "unavailable", Message: managed.Redact(info.Error, secrets...)})
		}
	} else {
		health.Components = append(health.Components, managed.Component{ID: "katago", State: "initializing", Message: "KataGo is initializing."})
	}
	if len(health.Components) > 0 {
		health.State = "degraded"
	}
	return health
}

func main() {
	if err := execute(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}
func execute() error {
	dirFlag := flag.String("dir", "", "JCGO home directory")
	flag.Parse()
	dir := *dirFlag
	if dir == "" {
		var err error
		dir, err = config.DefaultDir()
		if err != nil {
			return err
		}
	}
	cfg, err := config.LoadDir(dir)
	if err != nil {
		return err
	}
	if err := config.EnsureDirs(cfg); err != nil {
		return err
	}
	file, err := os.OpenFile(cfg.WorkerLogPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer file.Close()
	writer := managed.RedactingWriter{Writer: io.MultiWriter(os.Stderr, file), Secrets: []string{cfg.Server.Token, cfg.Worker.Token}}
	previous := log.Writer()
	log.SetOutput(writer)
	defer log.SetOutput(previous)
	logger := log.New(writer, "", log.LstdFlags)
	parent, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	health := &workerHealth{secrets: []string{cfg.Server.Token, cfg.Worker.Token}}
	control := managed.Start(parent, managed.Options{Enabled: managed.Enabled(), Input: os.Stdin, Output: os.Stdout, Health: health.snapshot})
	defer control.Close()
	err = run(control.Context(), runOptions{Dir: dir, Logger: logger, Ready: func() error { return control.Ready("1.0.0") }, Health: health})
	if control.Err() != nil {
		return control.Err()
	}
	if errors.Is(err, context.Canceled) {
		return nil
	}
	return err
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
	if opts.Health == nil {
		opts.Health = &workerHealth{}
	}
	if opts.ServeConnection == nil {
		opts.ServeConnection = func(ctx context.Context, endpoint, token string, runtime worker.ClientRuntime) error {
			return worker.ServeConnectionWithStatus(ctx, endpoint, token, runtime, func(connected bool) {
				opts.Health.mu.Lock()
				opts.Health.connected = connected
				if connected {
					opts.Health.connectionError = ""
				}
				opts.Health.mu.Unlock()
			})
		}
	}
	cfg, err := config.LoadDir(opts.Dir)
	if err != nil {
		return err
	}
	if !cfg.Worker.Enabled {
		opts.Logger.Print("worker disabled in config")
		return nil
	}
	instance, err := managed.Acquire(opts.Dir, "worker", managed.Enabled())
	if err != nil {
		return err
	}
	defer instance.Close()
	if opts.Ready != nil {
		if err := opts.Ready(); err != nil {
			return err
		}
	}
	runtimeEngine, err := worker.NewRuntime(worker.RuntimeOptions{Context: ctx, Dir: opts.Dir, Logger: opts.Logger, StartLocal: opts.StartLocal})
	if err != nil {
		return err
	}
	defer runtimeEngine.Close()
	opts.Health.mu.Lock()
	opts.Health.runtime = runtimeEngine
	opts.Health.mu.Unlock()
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		cfg, err := config.LoadDir(opts.Dir)
		if err != nil {
			return err
		}
		endpoint, _ := url.Parse(cfg.Worker.URL)
		safeEndpoint := "configured server"
		if endpoint != nil {
			safeEndpoint = endpoint.Scheme + "://" + endpoint.Host + endpoint.EscapedPath()
		}
		opts.Logger.Printf("connecting to %s", safeEndpoint)
		err = opts.ServeConnection(ctx, cfg.Worker.URL, cfg.Worker.Token, runtimeEngine)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if errors.Is(err, context.Canceled) {
			return err
		}
		message := managed.Redact("connection ended: "+errorMessage(err), cfg.Server.Token, cfg.Worker.Token, cfg.Worker.URL)
		opts.Logger.Print(message)
		opts.Health.mu.Lock()
		opts.Health.connected = false
		opts.Health.connectionError = message
		opts.Health.mu.Unlock()
		if opts.Sleep != nil {
			opts.Sleep(5 * time.Second)
		} else {
			timer := time.NewTimer(5 * time.Second)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
			}
		}
	}
}
func errorMessage(err error) string {
	if err == nil {
		return "closed"
	}
	return err.Error()
}
