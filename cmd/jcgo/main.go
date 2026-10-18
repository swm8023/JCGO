package main

import (
	"context"
	"errors"
	"flag"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"jcgo/internal/app"
	"jcgo/internal/config"
	"jcgo/internal/hubregistration"
	"jcgo/internal/managed"
	"jcgo/internal/server"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}

func run(args []string) (result error) {
	cfg, err := config.LoadDir(configDirFromArgs(args))
	if err != nil {
		return err
	}
	if !cfg.Server.Enabled {
		log.Print("server disabled in config")
		return nil
	}
	if err := config.EnsureDirs(cfg); err != nil {
		return err
	}
	instance, err := managed.Acquire(cfg.Dir, "server", managed.Enabled())
	if err != nil {
		return err
	}
	defer instance.Close()
	file, err := os.OpenFile(cfg.ServerLogPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
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
	var healthMu sync.RWMutex
	var application *app.App
	control := managed.Start(parent, managed.Options{Enabled: managed.Enabled(), Input: os.Stdin, Output: os.Stdout, Health: func() managed.Health {
		healthMu.RLock()
		current := application
		healthMu.RUnlock()
		if current == nil {
			return managed.ErrorHealth("http", "initializing", nil)
		}
		status := current.Workers.StatusSnapshot()
		state := "healthy"
		workerState := "available"
		if status.Available == 0 {
			state = "degraded"
			workerState = "unavailable"
		}
		return managed.Health{State: state, Components: []managed.Component{{ID: "http", State: "running"}, {ID: "storage", State: "ready"}, {ID: "workers", State: workerState}}}
	}})
	defer control.Close()
	defer func() {
		if control.Err() != nil {
			result = control.Err()
		} else if errors.Is(result, context.Canceled) {
			result = nil
		}
	}()
	ctx := control.Context()
	current, err := app.New(ctx, cfg)
	if err != nil {
		return err
	}
	healthMu.Lock()
	application = current
	healthMu.Unlock()
	defer application.Close()
	srv := server.NewWithWorker(server.Config{AccessToken: cfg.AccessToken, StaticDir: cfg.WebDir}, application.RPC, application.Workers)
	listener, err := net.Listen("tcp", cfg.ListenAddr)
	if err != nil {
		return err
	}
	httpServer := &http.Server{Handler: srv.Handler(), ReadHeaderTimeout: 10 * time.Second}
	defer listener.Close()
	serving := make(chan error, 1)
	go func() { serving <- httpServer.Serve(listener) }()
	logger.Printf("jcgo listening on %s", listener.Addr())
	if err := control.Ready("1.0.0"); err != nil {
		srv.Close()
		httpServer.Close()
		if ctx.Err() != nil {
			return control.Err()
		}
		return err
	}
	var publisher *hubregistration.Publisher
	if cfg.Hub.Enabled {
		publisher = hubregistration.Publish(ctx, cfg.Hub.StateDir, "http://"+listener.Addr().String())
		defer publisher.Close()
	}
	// Publication errors remain diagnostic and never stop the local HTTP server.
	var serveErr error
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	lastPublication := ""
	running := true
	for running {
		select {
		case <-ctx.Done():
			running = false
		case serveErr = <-serving:
			running = false
		case <-ticker.C:
			if publisher != nil {
				snapshot, err := publisher.Snapshot()
				message := snapshot.State + " " + snapshot.PublicURL
				if err != nil {
					message = err.Error()
				}
				message = managed.Redact(message, cfg.Server.Token, cfg.Worker.Token)
				if message != lastPublication {
					logger.Printf("Hub publication: %s", message)
					lastPublication = message
				}
			}
		}
	}
	if publisher != nil {
		publisher.Close()
	}
	stop()
	control.Close()
	srv.Close()
	drain, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(drain); err != nil {
		_ = httpServer.Close()
		return err
	}
	if err := control.Err(); err != nil {
		return err
	}
	if errors.Is(serveErr, http.ErrServerClosed) {
		return nil
	}
	return serveErr
}

func configDirFromArgs(args []string) string {
	fs := flag.NewFlagSet("jcgo", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	dir := fs.String("dir", "", "JCGO home directory")
	_ = fs.Parse(args)
	if *dir != "" {
		return *dir
	}
	defaultDir, err := config.DefaultDir()
	if err != nil {
		return ""
	}
	return defaultDir
}
