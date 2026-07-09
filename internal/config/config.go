package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

type Config struct {
	Dir                string
	Server             ServerConfig
	Worker             WorkerConfig
	Log                LogConfig
	ListenAddr         string
	AccessToken        string
	DatabasePath       string
	GamesDir           string
	WebDir             string
	ServerLogPath      string
	WorkerLogPath      string
	KatagoPath         string
	ModelPath          string
	AnalysisConfigPath string
}

type ServerConfig struct {
	Enabled bool   `json:"enabled"`
	Port    int    `json:"port"`
	Token   string `json:"token"`
}

type WorkerConfig struct {
	Enabled   bool   `json:"enabled"`
	Name      string `json:"name"`
	URL       string `json:"url"`
	Token     string `json:"token"`
	Model     string `json:"model"`
	MaxVisits int    `json:"maxVisits"`
}

type LogConfig struct {
	Level string `json:"level"`
}

type KatagoBackendInfo struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

type fileConfig struct {
	Server ServerConfig `json:"server"`
	Worker WorkerConfig `json:"worker"`
	Log    LogConfig    `json:"log"`
}

func DefaultDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("home dir: %w", err)
	}
	return filepath.Join(home, ".jcgo"), nil
}

func Load() (Config, error) {
	dir, err := DefaultDir()
	if err != nil {
		return Config{}, err
	}
	return LoadDir(dir)
}

func LoadDir(dir string) (Config, error) {
	if strings.TrimSpace(dir) == "" {
		defaultDir, err := DefaultDir()
		if err != nil {
			return Config{}, err
		}
		dir = defaultDir
	}
	dir = filepath.Clean(dir)
	raw, err := readFileConfig(dir)
	if err != nil {
		return Config{}, err
	}
	if err := validate(raw); err != nil {
		return Config{}, fmt.Errorf("validate config %s: %w", filepath.Join(dir, "config.json"), err)
	}

	cfg := Config{
		Dir:                dir,
		Server:             raw.Server,
		Worker:             raw.Worker,
		Log:                raw.Log,
		ListenAddr:         fmt.Sprintf("127.0.0.1:%d", raw.Server.Port),
		AccessToken:        raw.Server.Token,
		DatabasePath:       filepath.Join(dir, "db", "jcgo.sqlite"),
		GamesDir:           filepath.Join(dir, "games"),
		WebDir:             filepath.Join(dir, "web"),
		ServerLogPath:      filepath.Join(dir, "log", "server.log"),
		WorkerLogPath:      filepath.Join(dir, "log", "worker.log"),
		KatagoPath:         filepath.Join(dir, "bin", exeName("katago")),
		ModelPath:          filepath.Join(dir, "model", raw.Worker.Model),
		AnalysisConfigPath: filepath.Join(dir, "config", "analysis_config.cfg"),
	}
	return cfg, nil
}

func UpdateWorkerRuntime(dir string, model string, maxVisits int) error {
	raw, err := readFileConfig(dir)
	if err != nil {
		return err
	}
	raw.Worker.Model = model
	raw.Worker.MaxVisits = maxVisits
	return writeFileConfig(dir, raw)
}

func LoadKatagoBackendInfo(dir string) KatagoBackendInfo {
	path := filepath.Join(filepath.Clean(dir), "config", "katago_backend.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return KatagoBackendInfo{ID: "unknown", Label: "unknown"}
	}
	var info KatagoBackendInfo
	if err := json.Unmarshal(data, &info); err != nil {
		return KatagoBackendInfo{ID: "unknown", Label: "unknown"}
	}
	if strings.TrimSpace(info.ID) == "" {
		info.ID = "unknown"
	}
	if strings.TrimSpace(info.Label) == "" {
		info.Label = info.ID
	}
	return info
}

func EnsureDirs(cfg Config) error {
	for _, dir := range []string{
		filepath.Join(cfg.Dir, "bin"),
		filepath.Dir(cfg.DatabasePath),
		cfg.GamesDir,
		filepath.Dir(cfg.ServerLogPath),
		filepath.Join(cfg.Dir, "model"),
		filepath.Dir(cfg.AnalysisConfigPath),
		cfg.WebDir,
	} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("create %s: %w", dir, err)
		}
	}
	return nil
}

func DefaultFile(model string) []byte {
	raw := fileConfig{
		Server: ServerConfig{Enabled: true, Port: 4380, Token: "dev-token"},
		Worker: WorkerConfig{
			Enabled:   true,
			Name:      "local-gpu",
			URL:       "ws://127.0.0.1:4380/worker",
			Token:     "dev-token",
			Model:     model,
			MaxVisits: 500,
		},
		Log: LogConfig{Level: "warn"},
	}
	data, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		panic(err)
	}
	return append(data, '\n')
}

func readFileConfig(dir string) (fileConfig, error) {
	path := filepath.Join(filepath.Clean(dir), "config.json")
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fileConfig{}, fmt.Errorf("config file not found at %s", path)
		}
		return fileConfig{}, fmt.Errorf("read config %s: %w", path, err)
	}
	var raw fileConfig
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&raw); err != nil {
		return fileConfig{}, fmt.Errorf("parse config %s: %w", path, err)
	}
	return raw, nil
}

func writeFileConfig(dir string, raw fileConfig) error {
	data, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(filepath.Clean(dir), "config.json"), append(data, '\n'), 0o644)
}

func validate(raw fileConfig) error {
	var missing []string
	if raw.Server.Enabled {
		if raw.Server.Port <= 0 {
			missing = append(missing, "server.port")
		}
		if strings.TrimSpace(raw.Server.Token) == "" {
			missing = append(missing, "server.token")
		}
	}
	if raw.Worker.Enabled {
		if strings.TrimSpace(raw.Worker.Name) == "" {
			missing = append(missing, "worker.name")
		}
		if strings.TrimSpace(raw.Worker.URL) == "" {
			missing = append(missing, "worker.url")
		}
		if strings.TrimSpace(raw.Worker.Token) == "" {
			missing = append(missing, "worker.token")
		}
		if raw.Worker.MaxVisits <= 0 {
			missing = append(missing, "worker.maxVisits")
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing or invalid fields: %s", strings.Join(missing, ", "))
	}
	return nil
}

func exeName(name string) string {
	if runtime.GOOS == "windows" && !strings.HasSuffix(name, ".exe") {
		return name + ".exe"
	}
	return name
}
