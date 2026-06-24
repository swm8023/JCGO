package config

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"
)

type Config struct {
	ListenAddr         string
	AccessToken        string
	DataDir            string
	DatabasePath       string
	GamesDir           string
	KatagoPath         string
	ModelPath          string
	AnalysisConfigPath string
	MaxVisits          int
}

func Load() (Config, error) {
	dataDir := env("JCGO_DATA_DIR", filepath.Join(".", "data"))
	cfg := Config{
		ListenAddr:         env("JCGO_LISTEN_ADDR", "127.0.0.1:4380"),
		AccessToken:        os.Getenv("JCGO_ACCESS_TOKEN"),
		DataDir:            dataDir,
		DatabasePath:       filepath.Join(dataDir, "jcgo.sqlite"),
		GamesDir:           filepath.Join(dataDir, "games"),
		KatagoPath:         os.Getenv("JCGO_KATAGO_PATH"),
		ModelPath:          os.Getenv("JCGO_MODEL_PATH"),
		AnalysisConfigPath: os.Getenv("JCGO_ANALYSIS_CONFIG_PATH"),
		MaxVisits:          envInt("JCGO_MAX_VISITS", 500),
	}
	if cfg.AccessToken == "" {
		return Config{}, errors.New("JCGO_ACCESS_TOKEN is required")
	}
	return cfg, nil
}

func EnsureDirs(cfg Config) error {
	if err := os.MkdirAll(cfg.GamesDir, 0o755); err != nil {
		return err
	}
	return os.MkdirAll(filepath.Dir(cfg.DatabasePath), 0o755)
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envInt(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}
