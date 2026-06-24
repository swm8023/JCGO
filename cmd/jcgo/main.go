package main

import (
	"context"
	"log"
	"net/http"

	"jcgo/internal/app"
	"jcgo/internal/config"
	"jcgo/internal/server"
	"jcgo/internal/store"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	if err := config.EnsureDirs(cfg); err != nil {
		log.Fatal(err)
	}
	repo, err := store.Open(context.Background(), cfg.DatabasePath)
	if err != nil {
		log.Fatal(err)
	}
	defer repo.Close()
	handler := app.NewHandler(repo, store.NewFileStore(cfg.GamesDir), app.NewWorkspaceStore(), nil)
	srv := server.New(server.Config{AccessToken: cfg.AccessToken}, handler)
	log.Printf("jcgo listening on %s", cfg.ListenAddr)
	log.Fatal(http.ListenAndServe(cfg.ListenAddr, srv.Handler()))
}
