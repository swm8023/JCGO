package main

import (
	"context"
	"flag"
	"io"
	"log"
	"net/http"
	"os"

	"jcgo/internal/app"
	"jcgo/internal/config"
	"jcgo/internal/server"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		log.Fatal(err)
	}
}

func run(args []string) error {
	dir := configDirFromArgs(args)
	cfg, err := config.LoadDir(dir)
	if err != nil {
		return err
	}
	if !cfg.Server.Enabled {
		log.Printf("server disabled in config")
		return nil
	}
	if err := config.EnsureDirs(cfg); err != nil {
		return err
	}
	logFile, err := os.OpenFile(cfg.ServerLogPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer logFile.Close()
	logger := log.New(io.MultiWriter(os.Stdout, logFile), "", log.LstdFlags)

	application, err := app.New(context.Background(), cfg)
	if err != nil {
		return err
	}
	defer application.Close()
	srv := server.NewWithWorker(server.Config{AccessToken: cfg.AccessToken, StaticDir: cfg.WebDir}, application.RPC, application.Workers)
	logger.Printf("jcgo listening on %s", cfg.ListenAddr)
	return http.ListenAndServe(cfg.ListenAddr, srv.Handler())
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
