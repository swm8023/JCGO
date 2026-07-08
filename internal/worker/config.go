package worker

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
)

type Config struct {
	ServerURL          string `json:"serverUrl"`
	AccessToken        string `json:"accessToken"`
	WorkerName         string `json:"workerName"`
	KatagoPath         string `json:"katagoPath"`
	ModelPath          string `json:"modelPath"`
	AnalysisConfigPath string `json:"analysisConfigPath"`
}

func ExampleConfigJSON() []byte {
	return []byte(`{
  "serverUrl": "ws://127.0.0.1:4380/worker",
  "accessToken": "dev-token",
  "workerName": "gpu-worker-1",
  "katagoPath": "D:\\KataGo\\katago.exe",
  "modelPath": "D:\\KataGo\\models\\model.bin.gz",
  "analysisConfigPath": "D:\\KataGo\\analysis_config.cfg"
}
`)
}

func LoadOrCreateConfig(path string) (Config, bool, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		if err := os.WriteFile(path, ExampleConfigJSON(), 0o644); err != nil {
			return Config{}, false, err
		}
		return Config{}, true, nil
	}
	if err != nil {
		return Config{}, false, err
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Config{}, false, err
	}
	return cfg, false, nil
}

func (c Config) MissingFields() []string {
	fields := []struct {
		name  string
		value string
	}{
		{name: "serverUrl", value: c.ServerURL},
		{name: "accessToken", value: c.AccessToken},
		{name: "workerName", value: c.WorkerName},
		{name: "katagoPath", value: c.KatagoPath},
		{name: "modelPath", value: c.ModelPath},
		{name: "analysisConfigPath", value: c.AnalysisConfigPath},
	}
	missing := make([]string, 0)
	for _, field := range fields {
		if strings.TrimSpace(field.value) == "" {
			missing = append(missing, field.name)
		}
	}
	return missing
}
