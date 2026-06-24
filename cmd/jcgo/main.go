package main

import (
	"log"
	"net/http"

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
	srv := server.New(server.Config{AccessToken: cfg.AccessToken}, nil)
	log.Printf("jcgo listening on %s", cfg.ListenAddr)
	log.Fatal(http.ListenAndServe(cfg.ListenAddr, srv.Handler()))
}
