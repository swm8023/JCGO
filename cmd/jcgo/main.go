package main

import (
	"context"
	"log"
	"net/http"

	"jcgo/internal/app"
	"jcgo/internal/config"
	"jcgo/internal/server"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	if err := config.EnsureDirs(cfg); err != nil {
		log.Fatal(err)
	}
	application, err := app.New(context.Background(), cfg)
	if err != nil {
		log.Fatal(err)
	}
	defer application.Close()
	srv := server.New(server.Config{AccessToken: cfg.AccessToken, StaticDir: "web/dist"}, application.RPC)
	log.Printf("jcgo listening on %s", cfg.ListenAddr)
	log.Fatal(http.ListenAndServe(cfg.ListenAddr, srv.Handler()))
}
