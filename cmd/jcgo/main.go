package main

import (
	"fmt"
	"log"

	"jcgo/internal/config"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	if err := config.EnsureDirs(cfg); err != nil {
		log.Fatal(err)
	}
	fmt.Printf("jcgo listening on %s\n", cfg.ListenAddr)
}
