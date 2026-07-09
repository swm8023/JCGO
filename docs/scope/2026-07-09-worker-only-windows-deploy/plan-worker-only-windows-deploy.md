# Worker-only Windows Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace direct local KataGo fallback with Worker-only analysis and add a Windows `~/.jcgo` deploy flow driven by one strict `config.json`.

**Architecture:** Runtime configuration moves to `~/.jcgo/config.json` and is loaded by both `jcgo.exe` and `jcgo-worker.exe` through a shared `internal/config` package. The server owns HTTP/RPC/storage and a Worker Pool with no local fallback; workers own KataGo startup, model selection, and `maxVisits`. Windows deploy is handled by a testable Go deploy package invoked by `deploy.bat` / `update-publish.bat`; generated `start.bat` and `stop.bat` manage only the installed server and worker binaries.

**Tech Stack:** Go 1.25, gorilla/websocket, modernc sqlite, React 19, Vite/Vitest, PowerShell-backed Windows batch wrappers.

---

## File Structure

- `internal/config/config.go`: Replace environment-based config with strict `config.json` loading, derived runtime paths, directory creation, and reusable default config encoding.
- `internal/config/config_test.go`: Replace env tests with strict config, missing config, unknown field, path derivation, and directory creation tests.
- `internal/deploy/deploy.go`: New testable deployment helpers for config generation, release asset copy, web copy, script generation, and binary installation orchestration.
- `internal/deploy/deploy_test.go`: Unit tests for config preservation, model selection, asset overwrite, and generated script content.
- `cmd/jcgo-deploy/main.go`: New Windows deploy command wrapper around `internal/deploy`.
- `deploy.bat`, `update-publish.bat`: New root wrappers that run `go run ./cmd/jcgo-deploy deploy` and `go run ./cmd/jcgo-deploy update`.
- `release-assets/.gitkeep`, `release-assets/model/.gitkeep`: Keep staging directories in git while ignoring large runtime assets.
- `.gitignore`: Ignore staged KataGo/model files while keeping `.gitkeep`.
- `internal/worker/pool.go`, `internal/worker/pool_test.go`: Remove fallback analyzer and `local` status; return errors directly when no Worker or failed Worker.
- `internal/app/app.go`, `internal/app/app_test.go`: Stop starting KataGo in the server; construct Scheduler with Worker Pool only.
- `internal/app/scheduler.go`, `internal/app/scheduler_test.go`, selected `internal/app/handlers_test.go`: Remove server-owned max visits.
- `internal/app/state.go`, `internal/app/state_payload.go`, selected `internal/app/handlers_test.go`: Remove `workerStatus.local` fallback payload.
- `internal/worker/client.go`, `internal/worker/client_test.go`: Apply `worker.maxVisits` to queries on the Worker side before calling KataGo.
- `cmd/jcgo-worker/main.go`, `cmd/jcgo-worker/main_test.go`: Load shared `config.json`, derive fixed KataGo/model/config paths, report unavailable Worker errors, and honor `--dir`.
- `cmd/jcgo/main.go`: Load shared config via `--dir`, log to `~/.jcgo/log/server.log`, serve static files from `~/.jcgo/web`, and exit cleanly when server is disabled.
- `web/src/api/types.ts`: Remove `EngineStatus` and `WorkerStatus.local`.
- `web/src/components/SettingsPage.tsx`, `web/src/components/SettingsPage.test.tsx`: Show Worker-only status text and errors.
- `web/src/App.navigation.test.tsx`: Remove test fixtures that still include `workerStatus.local`.
- `README.md`, `CLAUDE.md`: Replace env startup and old worker packaging documentation with Windows deploy/config/start instructions.
- `scripts/build-worker.ps1`, `configs/jcgo-worker.example.json`: Delete old standalone worker release path after the new deploy flow is in place.

---

### Task 1: Shared Runtime Config

**Files:**
- Modify: `internal/config/config.go`
- Modify: `internal/config/config_test.go`

- [ ] **Step 1: Replace env config tests with strict file-based config tests**

Replace `internal/config/config_test.go` with tests that describe the new API:

```go
package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadDirReadsStrictConfigAndDerivesRuntimePaths(t *testing.T) {
	dir := t.TempDir()
	raw := []byte(`{
  "server": {"enabled": true, "port": 4380, "token": "server-token"},
  "worker": {"enabled": true, "name": "local-gpu", "url": "ws://127.0.0.1:4380/worker", "token": "worker-token", "model": "model.bin.gz", "maxVisits": 700},
  "log": {"level": "debug"}
}`)
	if err := os.WriteFile(filepath.Join(dir, "config.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}

	cfg, err := LoadDir(dir)
	if err != nil {
		t.Fatalf("LoadDir returned error: %v", err)
	}

	if cfg.Dir != filepath.Clean(dir) {
		t.Fatalf("Dir = %q", cfg.Dir)
	}
	if cfg.ListenAddr != "127.0.0.1:4380" || cfg.AccessToken != "server-token" {
		t.Fatalf("server derivation = %#v", cfg)
	}
	if cfg.Worker.Name != "local-gpu" || cfg.Worker.MaxVisits != 700 {
		t.Fatalf("worker = %#v", cfg.Worker)
	}
	if cfg.DatabasePath != filepath.Join(dir, "db", "jcgo.sqlite") {
		t.Fatalf("DatabasePath = %q", cfg.DatabasePath)
	}
	if cfg.GamesDir != filepath.Join(dir, "games") {
		t.Fatalf("GamesDir = %q", cfg.GamesDir)
	}
	if cfg.WebDir != filepath.Join(dir, "web") {
		t.Fatalf("WebDir = %q", cfg.WebDir)
	}
	if cfg.KatagoPath != filepath.Join(dir, "bin", exeName("katago")) {
		t.Fatalf("KatagoPath = %q", cfg.KatagoPath)
	}
	if cfg.ModelPath != filepath.Join(dir, "model", "model.bin.gz") {
		t.Fatalf("ModelPath = %q", cfg.ModelPath)
	}
	if cfg.AnalysisConfigPath != filepath.Join(dir, "config", "analysis_config.cfg") {
		t.Fatalf("AnalysisConfigPath = %q", cfg.AnalysisConfigPath)
	}
	if cfg.ServerLogPath != filepath.Join(dir, "log", "server.log") || cfg.WorkerLogPath != filepath.Join(dir, "log", "worker.log") {
		t.Fatalf("log paths = %q %q", cfg.ServerLogPath, cfg.WorkerLogPath)
	}
}

func TestLoadDirRejectsMissingConfig(t *testing.T) {
	_, err := LoadDir(t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "config file not found") {
		t.Fatalf("err = %v", err)
	}
}

func TestLoadDirRejectsUnknownFields(t *testing.T) {
	dir := t.TempDir()
	raw := []byte(`{
  "server": {"enabled": true, "port": 4380, "token": "server-token", "extra": true},
  "worker": {"enabled": false, "name": "", "url": "", "token": "", "model": "", "maxVisits": 500},
  "log": {"level": "warn"}
}`)
	if err := os.WriteFile(filepath.Join(dir, "config.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := LoadDir(dir)
	if err == nil || !strings.Contains(err.Error(), `unknown field "extra"`) {
		t.Fatalf("err = %v", err)
	}
}

func TestLoadDirValidatesEnabledSections(t *testing.T) {
	dir := t.TempDir()
	raw := []byte(`{
  "server": {"enabled": true, "port": 0, "token": ""},
  "worker": {"enabled": true, "name": "", "url": "", "token": "", "model": "", "maxVisits": 0},
  "log": {"level": "warn"}
}`)
	if err := os.WriteFile(filepath.Join(dir, "config.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := LoadDir(dir)
	if err == nil {
		t.Fatal("expected validation error")
	}
	for _, want := range []string{"server.port", "server.token", "worker.name", "worker.url", "worker.token", "worker.maxVisits"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("err = %v, missing %s", err, want)
		}
	}
}

func TestEnsureDirsCreatesRuntimeDirectories(t *testing.T) {
	dir := t.TempDir()
	cfg := Config{
		Dir:          dir,
		DatabasePath: filepath.Join(dir, "db", "jcgo.sqlite"),
		GamesDir:     filepath.Join(dir, "games"),
		WebDir:       filepath.Join(dir, "web"),
		ServerLogPath: filepath.Join(dir, "log", "server.log"),
		WorkerLogPath: filepath.Join(dir, "log", "worker.log"),
		KatagoPath:   filepath.Join(dir, "bin", exeName("katago")),
		ModelPath:    filepath.Join(dir, "model", "model.bin.gz"),
		AnalysisConfigPath: filepath.Join(dir, "config", "analysis_config.cfg"),
	}

	if err := EnsureDirs(cfg); err != nil {
		t.Fatalf("EnsureDirs returned error: %v", err)
	}

	for _, path := range []string{
		filepath.Join(dir, "bin"),
		filepath.Join(dir, "db"),
		filepath.Join(dir, "games"),
		filepath.Join(dir, "log"),
		filepath.Join(dir, "model"),
		filepath.Join(dir, "config"),
		filepath.Join(dir, "web"),
	} {
		if info, err := os.Stat(path); err != nil || !info.IsDir() {
			t.Fatalf("dir %s stat = %v info=%#v", path, err, info)
		}
	}
}
```

- [ ] **Step 2: Run config tests to verify they fail**

Run: `go test ./internal/config`

Expected: FAIL with errors for undefined `LoadDir`, `exeName`, and new `Config` fields.

- [ ] **Step 3: Implement strict config loading and derived paths**

Replace `internal/config/config.go` with:

```go
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
	path := filepath.Join(dir, "config.json")
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Config{}, fmt.Errorf("config file not found at %s", path)
		}
		return Config{}, fmt.Errorf("read config %s: %w", path, err)
	}

	var raw fileConfig
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&raw); err != nil {
		return Config{}, fmt.Errorf("parse config %s: %w", path, err)
	}
	if err := validate(raw); err != nil {
		return Config{}, fmt.Errorf("validate config %s: %w", path, err)
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
```

- [ ] **Step 4: Run config tests to verify they pass**

Run: `go test ./internal/config`

Expected: PASS.

- [ ] **Step 5: Commit config foundation**

```powershell
git add internal/config/config.go internal/config/config_test.go
git commit -m "Add strict runtime config loader"
```

---

### Task 2: Testable Windows Deploy Core

**Files:**
- Create: `internal/deploy/deploy.go`
- Create: `internal/deploy/deploy_test.go`
- Create: `cmd/jcgo-deploy/main.go`
- Create: `deploy.bat`
- Create: `update-publish.bat`
- Create: `release-assets/.gitkeep`
- Create: `release-assets/model/.gitkeep`
- Modify: `.gitignore`

- [ ] **Step 1: Add deploy tests for config generation and asset copy**

Create `internal/deploy/deploy_test.go`:

```go
package deploy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnsureConfigCreatesDefaultWithFirstSortedModel(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "home")
	repo := filepath.Join(root, "repo")
	modelDir := filepath.Join(repo, "release-assets", "model")
	if err := os.MkdirAll(modelDir, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"z-model.bin.gz", "a-model.bin.gz"} {
		if err := os.WriteFile(filepath.Join(modelDir, name), []byte(name), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	created, err := EnsureConfig(Options{RepoRoot: repo, HomeDir: home})
	if err != nil {
		t.Fatalf("EnsureConfig returned error: %v", err)
	}
	if !created {
		t.Fatal("created = false")
	}
	raw, err := os.ReadFile(filepath.Join(home, ".jcgo", "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"model": "a-model.bin.gz"`) {
		t.Fatalf("config = %s", raw)
	}
}

func TestEnsureConfigPreservesExistingConfig(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "home")
	repo := filepath.Join(root, "repo")
	state := filepath.Join(home, ".jcgo")
	if err := os.MkdirAll(state, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(state, "config.json")
	existing := []byte(`{"server":{"enabled":false,"port":4380,"token":""},"worker":{"enabled":false,"name":"","url":"","token":"","model":"custom.bin.gz","maxVisits":500},"log":{"level":"warn"}}`)
	if err := os.WriteFile(path, existing, 0o644); err != nil {
		t.Fatal(err)
	}

	created, err := EnsureConfig(Options{RepoRoot: repo, HomeDir: home})
	if err != nil {
		t.Fatalf("EnsureConfig returned error: %v", err)
	}
	if created {
		t.Fatal("created = true")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != string(existing) {
		t.Fatalf("config overwritten: %s", raw)
	}
}

func TestCopyReleaseAssetsOverwritesRuntimeAssets(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "home")
	repo := filepath.Join(root, "repo")
	if err := os.MkdirAll(filepath.Join(repo, "release-assets", "model"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "release-assets", "katago.exe"), []byte("new-katago"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "release-assets", "analysis_config.cfg"), []byte("new-config"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "release-assets", "model", "model.bin.gz"), []byte("new-model"), 0o644); err != nil {
		t.Fatal(err)
	}
	state := filepath.Join(home, ".jcgo")
	if err := os.MkdirAll(filepath.Join(state, "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(state, "bin", "katago.exe"), []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := CopyReleaseAssets(Options{RepoRoot: repo, HomeDir: home}); err != nil {
		t.Fatalf("CopyReleaseAssets returned error: %v", err)
	}

	assertFile(t, filepath.Join(state, "bin", "katago.exe"), "new-katago")
	assertFile(t, filepath.Join(state, "config", "analysis_config.cfg"), "new-config")
	assertFile(t, filepath.Join(state, "model", "model.bin.gz"), "new-model")
}

func TestWriteScriptsUsesInstalledHomeAndDirFlag(t *testing.T) {
	home := filepath.Join(t.TempDir(), "home")
	if err := WriteScripts(Options{HomeDir: home}); err != nil {
		t.Fatalf("WriteScripts returned error: %v", err)
	}
	state := filepath.Join(home, ".jcgo")
	start, err := os.ReadFile(filepath.Join(state, "start.bat"))
	if err != nil {
		t.Fatal(err)
	}
	stop, err := os.ReadFile(filepath.Join(state, "stop.bat"))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"jcgo.exe", "jcgo-worker.exe", "--dir"} {
		if !strings.Contains(string(start), want) {
			t.Fatalf("start.bat missing %q:\n%s", want, start)
		}
	}
	for _, want := range []string{"Get-CimInstance Win32_Process", "jcgo.exe", "jcgo-worker.exe", ".ExecutablePath"} {
		if !strings.Contains(string(stop), want) {
			t.Fatalf("stop.bat missing %q:\n%s", want, stop)
		}
	}
}

func assertFile(t *testing.T, path string, want string) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != want {
		t.Fatalf("%s = %q, want %q", path, raw, want)
	}
}
```

- [ ] **Step 2: Run deploy tests to verify they fail**

Run: `go test ./internal/deploy`

Expected: FAIL because `internal/deploy` does not exist.

- [ ] **Step 3: Implement deploy helpers**

Create `internal/deploy/deploy.go`:

```go
package deploy

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"jcgo/internal/config"
)

type Options struct {
	RepoRoot string
	HomeDir  string
	Pull     bool
	Runner   Runner
}

type Runner interface {
	Run(ctx context.Context, dir string, name string, args ...string) error
}

type ExecRunner struct{}

func (ExecRunner) Run(ctx context.Context, dir string, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func Deploy(ctx context.Context, opts Options) error {
	opts = resolve(opts)
	runner := opts.Runner
	if runner == nil {
		runner = ExecRunner{}
	}
	if opts.Pull {
		if err := runner.Run(ctx, opts.RepoRoot, "git", "pull", "--ff-only"); err != nil {
			return err
		}
	}
	if err := createRuntimeDirs(opts); err != nil {
		return err
	}
	if err := runner.Run(ctx, opts.RepoRoot, "go", "build", "-o", filepath.Join(StateDir(opts), "bin", exeName("jcgo")), "./cmd/jcgo"); err != nil {
		return err
	}
	if err := runner.Run(ctx, opts.RepoRoot, "go", "build", "-o", filepath.Join(StateDir(opts), "bin", exeName("jcgo-worker")), "./cmd/jcgo-worker"); err != nil {
		return err
	}
	if err := runner.Run(ctx, filepath.Join(opts.RepoRoot, "web"), "npm", "run", "build"); err != nil {
		return err
	}
	if err := copyDir(filepath.Join(opts.RepoRoot, "web", "dist"), filepath.Join(StateDir(opts), "web")); err != nil {
		return err
	}
	if _, err := EnsureConfig(opts); err != nil {
		return err
	}
	if err := CopyReleaseAssets(opts); err != nil {
		return err
	}
	return WriteScripts(opts)
}

func EnsureConfig(opts Options) (bool, error) {
	opts = resolve(opts)
	path := filepath.Join(StateDir(opts), "config.json")
	if _, err := os.Stat(path); err == nil {
		return false, nil
	} else if err != nil && !os.IsNotExist(err) {
		return false, fmt.Errorf("stat config: %w", err)
	}
	model := firstModel(filepath.Join(opts.RepoRoot, "release-assets", "model"))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return false, err
	}
	if err := os.WriteFile(path, config.DefaultFile(model), 0o644); err != nil {
		return false, err
	}
	return true, nil
}

func CopyReleaseAssets(opts Options) error {
	opts = resolve(opts)
	state := StateDir(opts)
	assets := filepath.Join(opts.RepoRoot, "release-assets")
	if err := copyFileIfExists(filepath.Join(assets, "katago.exe"), filepath.Join(state, "bin", "katago.exe")); err != nil {
		return err
	}
	if err := copyFileIfExists(filepath.Join(assets, "analysis_config.cfg"), filepath.Join(state, "config", "analysis_config.cfg")); err != nil {
		return err
	}
	modelDir := filepath.Join(assets, "model")
	entries, err := os.ReadDir(modelDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || entry.Name() == ".gitkeep" {
			continue
		}
		if err := copyFile(filepath.Join(modelDir, entry.Name()), filepath.Join(state, "model", entry.Name())); err != nil {
			return err
		}
	}
	return nil
}

func WriteScripts(opts Options) error {
	opts = resolve(opts)
	state := StateDir(opts)
	if err := os.MkdirAll(state, 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(state, "start.bat"), []byte(startScript(state)), 0o644); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(state, "stop.bat"), []byte(stopScript(state)), 0o644)
}

func StateDir(opts Options) string {
	return filepath.Join(opts.HomeDir, ".jcgo")
}

func resolve(opts Options) Options {
	if opts.HomeDir == "" {
		if home, err := os.UserHomeDir(); err == nil {
			opts.HomeDir = home
		}
	}
	if opts.RepoRoot == "" {
		if cwd, err := os.Getwd(); err == nil {
			opts.RepoRoot = cwd
		}
	}
	if abs, err := filepath.Abs(opts.RepoRoot); err == nil {
		opts.RepoRoot = abs
	}
	if abs, err := filepath.Abs(opts.HomeDir); err == nil {
		opts.HomeDir = abs
	}
	return opts
}

func createRuntimeDirs(opts Options) error {
	for _, dir := range []string{"bin", "db", "games", "log", "model", "config", "web"} {
		if err := os.MkdirAll(filepath.Join(StateDir(opts), dir), 0o755); err != nil {
			return err
		}
	}
	return nil
}

func firstModel(dir string) string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	var names []string
	for _, entry := range entries {
		if !entry.IsDir() && entry.Name() != ".gitkeep" {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	if len(names) == 0 {
		return ""
	}
	return names[0]
}

func copyFileIfExists(src string, dst string) error {
	if _, err := os.Stat(src); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	return copyFile(src, dst)
}

func copyFile(src string, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}

func copyDir(src string, dst string) error {
	return filepath.WalkDir(src, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		return copyFile(path, target)
	})
}

func startScript(state string) string {
	quoted := psQuote(filepath.Clean(state))
	return "@echo off\r\nsetlocal\r\npowershell -NoProfile -ExecutionPolicy Bypass -Command \"$ErrorActionPreference='Stop'; $home=" + quoted + "; $cfg=Get-Content -Raw -LiteralPath (Join-Path $home 'config.json') | ConvertFrom-Json; if ($cfg.server.enabled) { Start-Process -FilePath (Join-Path $home 'bin\\jcgo.exe') -ArgumentList @('--dir', $home) -WorkingDirectory $home -WindowStyle Hidden }; if ($cfg.worker.enabled) { Start-Process -FilePath (Join-Path $home 'bin\\jcgo-worker.exe') -ArgumentList @('--dir', $home) -WorkingDirectory $home -WindowStyle Hidden }\"\r\nexit /b %errorlevel%\r\n"
}

func stopScript(state string) string {
	quoted := psQuote(filepath.Clean(state))
	return "@echo off\r\nsetlocal\r\npowershell -NoProfile -ExecutionPolicy Bypass -Command \"$ErrorActionPreference='Stop'; $home=" + quoted + "; $bin=(Join-Path $home 'bin'); $prefix=([System.IO.Path]::GetFullPath($bin).TrimEnd('\\') + '\\'); Get-CimInstance Win32_Process | Where-Object { @('jcgo.exe','jcgo-worker.exe') -contains $_.Name -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }\"\r\nexit /b %errorlevel%\r\n"
}

func psQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

func exeName(name string) string {
	if !strings.HasSuffix(strings.ToLower(name), ".exe") {
		return name + ".exe"
	}
	return name
}
```

- [ ] **Step 4: Add deploy CLI and root batch wrappers**

Create `cmd/jcgo-deploy/main.go`:

```go
package main

import (
	"context"
	"fmt"
	"os"

	"jcgo/internal/deploy"
)

func main() {
	if err := run(context.Background(), os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "jcgo-deploy: %v\n", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string) error {
	mode := "deploy"
	if len(args) > 0 {
		mode = args[0]
	}
	switch mode {
	case "deploy":
		return deploy.Deploy(ctx, deploy.Options{})
	case "update":
		return deploy.Deploy(ctx, deploy.Options{Pull: true})
	default:
		return fmt.Errorf("unsupported command %q", mode)
	}
}
```

Create `deploy.bat`:

```bat
@echo off
setlocal
cd /d "%~dp0"
go run ./cmd/jcgo-deploy deploy
exit /b %errorlevel%
```

Create `update-publish.bat`:

```bat
@echo off
setlocal
cd /d "%~dp0"
go run ./cmd/jcgo-deploy update
exit /b %errorlevel%
```

Create `release-assets/.gitkeep` and `release-assets/model/.gitkeep` as empty files.

Append to `.gitignore`:

```gitignore
release-assets/katago.exe
release-assets/analysis_config.cfg
release-assets/model/*
!release-assets/model/.gitkeep
```

- [ ] **Step 5: Run deploy tests**

Run: `go test ./internal/deploy`

Expected: PASS.

- [ ] **Step 6: Commit deploy foundation**

```powershell
git add internal/deploy cmd/jcgo-deploy deploy.bat update-publish.bat release-assets .gitignore
git commit -m "Add Windows deploy foundation"
```

---

### Task 3: Worker-only Pool And Status Payload

**Files:**
- Modify: `internal/worker/pool.go`
- Modify: `internal/worker/pool_test.go`
- Modify: `internal/app/state.go`
- Modify: `internal/app/handlers_test.go`

- [ ] **Step 1: Replace Pool tests to describe no fallback and no local status**

Edit `internal/worker/pool_test.go`:

```go
func TestPoolReturnsUnavailableWhenNoWorkerIsConnected(t *testing.T) {
	pool := NewPool(log.New(io.Discard, "", 0))

	_, err := pool.Analyze(context.Background(), katago.Query{ID: "main:0"})
	if err == nil || err.Error() != "no available workers" {
		t.Fatalf("err = %v", err)
	}
	if pool.Available() {
		t.Fatal("Available = true")
	}
	if status := pool.Status(); status.Available || status.Error != "no available workers" {
		t.Fatalf("status = %#v", status)
	}
}

func TestPoolReturnsWorkerErrorWithoutFallback(t *testing.T) {
	pool := NewPool(log.New(io.Discard, "", 0))
	serverURL, closeServer := servePool(t, pool)
	defer closeServer()

	go runFakeWorker(t, serverURL, func(conn *websocket.Conn, msg Envelope) {
		if err := conn.WriteJSON(Envelope{Type: MessageError, ID: msg.ID, Error: "worker failed"}); err != nil {
			t.Error(err)
		}
	})

	waitForWorkers(t, pool, 1)
	_, err := pool.Analyze(context.Background(), katago.Query{ID: "main:3"})
	if err == nil || err.Error() != "worker failed" {
		t.Fatalf("err = %v", err)
	}
}

func TestPoolStatusSnapshotCountsWorkersOnly(t *testing.T) {
	pool := NewPool(log.New(io.Discard, "", 0))
	pool.addWorker(&remoteWorker{
		id:        "worker-2",
		info:      Info{Name: "offline-gpu", Platform: "linux/amd64", Available: false, Error: "katago missing"},
		responses: map[string]chan Envelope{},
	})
	pool.addWorker(&remoteWorker{
		id:        "worker-1",
		info:      Info{Name: "busy-gpu", Platform: "windows/amd64", Available: true},
		busy:      true,
		responses: map[string]chan Envelope{},
	})

	status := pool.StatusSnapshot()

	if status.Connected != 2 || status.Available != 1 || status.Busy != 1 {
		t.Fatalf("counts = %#v", status)
	}
	if len(status.Workers) != 2 {
		t.Fatalf("workers = %#v", status.Workers)
	}
	if status.Workers[0].ID != "worker-1" || !status.Workers[0].Busy || !status.Workers[0].Available {
		t.Fatalf("first worker = %#v", status.Workers[0])
	}
	if status.Workers[1].ID != "worker-2" || status.Workers[1].Available || status.Workers[1].Error != "katago missing" {
		t.Fatalf("second worker = %#v", status.Workers[1])
	}
}
```

Update existing `NewPool(...)` calls in this test file to `NewPool(log.New(io.Discard, "", 0))`.

- [ ] **Step 2: Run worker pool tests to verify they fail**

Run: `go test ./internal/worker -run 'TestPool'`

Expected: FAIL because `NewPool` still requires a fallback and `StatusSnapshot` still has `Local`.

- [ ] **Step 3: Remove fallback from Pool implementation**

In `internal/worker/pool.go`, replace Pool construction and analysis paths with:

```go
type Pool struct {
	logger *log.Logger

	seq uint64
	mu  sync.Mutex
	ws  map[string]*remoteWorker
}

type StatusSnapshot struct {
	Connected int             `json:"connected"`
	Available int             `json:"available"`
	Busy      int             `json:"busy"`
	Workers   []RuntimeStatus `json:"workers"`
}

func NewPool(logger *log.Logger) *Pool {
	if logger == nil {
		logger = log.Default()
	}
	return &Pool{
		logger: logger,
		ws:     map[string]*remoteWorker{},
	}
}

func (p *Pool) AnalyzeWithProgress(ctx context.Context, query katago.Query, progress func(katago.Result)) (katago.Result, error) {
	worker := p.pickWorker()
	if worker == nil {
		p.logger.Printf("worker pool: no idle remote worker for query %s", query.ID)
		return katago.Result{}, errors.New("no available workers")
	}
	defer p.releaseWorker(worker)

	result, err := p.analyzeRemote(ctx, worker, query, progress)
	if err != nil {
		p.logger.Printf("worker pool: remote worker %s failed query %s: %v", worker.info.Name, query.ID, err)
		return katago.Result{}, err
	}
	return result, nil
}

func (p *Pool) Available() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, worker := range p.ws {
		if !worker.closed && worker.info.Available {
			return true
		}
	}
	return false
}

func (p *Pool) Status() katago.Status {
	if p.Available() {
		return katago.Status{Available: true}
	}
	return katago.Status{Available: false, Error: "no available workers"}
}

func (p *Pool) Close() error {
	p.mu.Lock()
	workers := make([]*remoteWorker, 0, len(p.ws))
	for _, worker := range p.ws {
		workers = append(workers, worker)
	}
	p.mu.Unlock()
	for _, worker := range workers {
		_ = worker.conn.Close()
	}
	return nil
}
```

Remove `fallback`, `analyzeFallback`, and assignments to `status.Local`.

- [ ] **Step 4: Remove local fallback from app state**

In `internal/app/state.go`, remove the `katago` import and change `currentWorkerStatus` to:

```go
func (h *Handler) currentWorkerStatus() worker.StatusSnapshot {
	if h.workerStatus == nil {
		return worker.StatusSnapshot{
			Workers: []worker.RuntimeStatus{},
		}
	}
	status := h.workerStatus.StatusSnapshot()
	if status.Workers == nil {
		status.Workers = []worker.RuntimeStatus{}
	}
	return status
}
```

In `internal/app/handlers_test.go`, remove `Local: katago.Status{Available: true},` from `TestWorkspaceStateIncludesWorkerStatus`.

- [ ] **Step 5: Run worker and app tests**

Run: `go test ./internal/worker ./internal/app`

Expected: worker Pool tests PASS; app tests may still fail where scheduler/app constructors still pass max visits or fallback. Those failures are resolved in Task 4.

- [ ] **Step 6: Commit Worker-only Pool**

```powershell
git add internal/worker/pool.go internal/worker/pool_test.go internal/app/state.go internal/app/handlers_test.go
git commit -m "Remove local analysis fallback from worker pool"
```

---

### Task 4: Server App Without KataGo Startup Or MaxVisits

**Files:**
- Modify: `internal/app/app.go`
- Modify: `internal/app/app_test.go`
- Modify: `internal/app/scheduler.go`
- Modify: `internal/app/scheduler_test.go`
- Modify: `internal/app/handlers_test.go`

- [ ] **Step 1: Update scheduler tests to use worker-owned visits**

In `internal/app/scheduler_test.go`, update constructor calls from `NewScheduler(engine, 500)` to `NewScheduler(engine)`.

Add this assertion to `TestSchedulerBuildsQueriesWithPolicyAndInitialPlayer` after `query := engine.queries[0]`:

```go
if query.MaxVisits != 0 {
	t.Fatalf("server query MaxVisits = %d, want worker-owned 0", query.MaxVisits)
}
```

In `internal/app/handlers_test.go`, update all `NewScheduler(&fakeAnalyzer{}, 500)` calls to `NewScheduler(&fakeAnalyzer{})`.

- [ ] **Step 2: Replace App test to assert no direct engine startup**

Replace `TestNewAppStartsWithUnavailableEngineWhenPathsMissing` in `internal/app/app_test.go` with:

```go
func TestNewAppUsesWorkerPoolWithoutLocalEngine(t *testing.T) {
	dataDir := t.TempDir()
	cfg := config.Config{
		Dir:          dataDir,
		AccessToken:  "secret",
		DatabasePath: filepath.Join(dataDir, "db", "jcgo.sqlite"),
		GamesDir:     filepath.Join(dataDir, "games"),
	}
	if err := config.EnsureDirs(cfg); err != nil {
		t.Fatal(err)
	}

	app, err := New(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()

	if app.EngineStatus().Available {
		t.Fatal("engine should be unavailable without connected workers")
	}
	if app.Workers == nil {
		t.Fatal("workers should be configured")
	}
	if app.RPC == nil || app.Scheduler == nil {
		t.Fatalf("app = %#v", app)
	}
}
```

- [ ] **Step 3: Run app tests to verify they fail**

Run: `go test ./internal/app`

Expected: FAIL because `NewScheduler` still takes `maxVisits`, app still calls `startEngine`, and config fields changed.

- [ ] **Step 4: Remove server-owned maxVisits from Scheduler**

In `internal/app/scheduler.go`, change the struct and constructor:

```go
type Scheduler struct {
	engine      katago.Analyzer
	tasks       chan task
	closed      chan struct{}
	closeOnce   sync.Once
	mu          sync.Mutex
	stopped     map[string]bool
	subscribers map[int]Subscriber
	nextSubID   int
}

func NewScheduler(engine katago.Analyzer) *Scheduler {
	s := &Scheduler{
		engine:      engine,
		tasks:       make(chan task, 256),
		closed:      make(chan struct{}),
		stopped:     map[string]bool{},
		subscribers: map[int]Subscriber{},
	}
	go s.run()
	return s
}
```

In `run`, build queries with zero visits so the Worker owns the final value:

```go
query := katago.BuildQuery(katago.BuildInput{
	ID:            task.node.NodeID,
	Rules:         task.node.Rules,
	Komi:          task.node.Komi,
	MaxVisits:     0,
	InitialStones: task.node.InitialStones,
	InitialPlayer: string(task.node.InitialPlayer),
	Moves:         task.node.Moves,
	AnalyzeTurn:   task.node.MoveNumber,
})
```

- [ ] **Step 5: Remove direct KataGo startup from App**

In `internal/app/app.go`, remove `errors`, `jcgo/internal/katago`, and `startEngine`. Update `New`:

```go
func New(ctx context.Context, cfg config.Config) (*App, error) {
	repo, err := store.Open(ctx, cfg.DatabasePath)
	if err != nil {
		return nil, err
	}
	files := store.NewFileStore(cfg.GamesDir)
	workers := worker.NewPool(log.Default())
	engine := workers
	workspaces := NewWorkspaceStore()
	scheduler := NewScheduler(engine)
	handler := NewHandlerWithOptions(repo, files, workspaces, scheduler, HandlerOptions{
		YuanluoboAuthStore:   NewYuanluoboFileAuthStore(filepath.Join(cfg.Dir, "db", "yuanluobo_auth.json")),
		WorkerStatusProvider: workers,
	})
	return &App{
		Repo:       repo,
		Files:      files,
		Workspaces: workspaces,
		Engine:     engine,
		Workers:    workers,
		Scheduler:  scheduler,
		RPC:        handler,
	}, nil
}
```

Keep `Engine katago.Analyzer` by retaining the `katago` import if the field still needs the interface type.

- [ ] **Step 6: Run app tests**

Run: `go test ./internal/app`

Expected: PASS.

- [ ] **Step 7: Commit server Worker-only app**

```powershell
git add internal/app
git commit -m "Make server analysis worker-only"
```

---

### Task 5: Worker Applies Runtime Config And maxVisits

**Files:**
- Modify: `internal/worker/client.go`
- Modify: `internal/worker/client_test.go`
- Delete or leave unused until Task 8: `internal/worker/config.go`
- Delete or leave unused until Task 8: `internal/worker/config_test.go`
- Modify: `cmd/jcgo-worker/main.go`
- Modify: `cmd/jcgo-worker/main_test.go`

- [ ] **Step 1: Add Worker client maxVisits test**

In `internal/worker/client_test.go`, extend `clientBasicAnalyzer`:

```go
type clientBasicAnalyzer struct {
	queries chan katago.Query
}

func (a clientBasicAnalyzer) Analyze(ctx context.Context, query katago.Query) (katago.Result, error) {
	if a.queries != nil {
		a.queries <- query
	}
	return katago.Result{ID: query.ID, RootInfo: katago.RootInfo{Visits: 88}}, nil
}
```

Add a test:

```go
func TestServeConnectionAppliesWorkerMaxVisits(t *testing.T) {
	server, connCh := testWorkerServer(t)
	defer server.Close()

	queries := make(chan katago.Query, 1)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		_ = ServeConnection(ctx, "ws"+server.URL[len("http"):], "secret", Info{Name: "worker-1", Available: true}, clientBasicAnalyzer{queries: queries}, 700)
	}()

	conn := <-connCh
	defer conn.Close()
	var register Envelope
	if err := conn.ReadJSON(&register); err != nil {
		t.Fatal(err)
	}
	if err := conn.WriteJSON(Envelope{Type: MessageAnalyze, ID: "job-1", Query: &katago.Query{ID: "main:0", MaxVisits: 1}}); err != nil {
		t.Fatal(err)
	}
	select {
	case query := <-queries:
		if query.MaxVisits != 700 {
			t.Fatalf("MaxVisits = %d, want 700", query.MaxVisits)
		}
	case <-time.After(time.Second):
		t.Fatal("expected query")
	}
}
```

Update existing `ServeConnection` test calls to pass `500`.

- [ ] **Step 2: Run Worker client tests to verify they fail**

Run: `go test ./internal/worker -run 'TestServeConnection'`

Expected: FAIL because `ServeConnection` does not accept `maxVisits`.

- [ ] **Step 3: Apply maxVisits in Worker client**

In `internal/worker/client.go`, update signatures and apply visits:

```go
func ServeConnection(ctx context.Context, serverURL string, accessToken string, info Info, engine katago.Analyzer, maxVisits int) error {
	dialer := websocket.Dialer{Subprotocols: []string{Subprotocol, "token." + accessToken}}
	conn, _, err := dialer.DialContext(ctx, serverURL, nil)
	if err != nil {
		return err
	}
	defer conn.Close()

	if err := conn.WriteJSON(Envelope{Type: MessageRegister, Worker: &info}); err != nil {
		return err
	}

	for {
		var msg Envelope
		if err := conn.ReadJSON(&msg); err != nil {
			return err
		}
		if msg.Type != MessageAnalyze || msg.Query == nil {
			_ = conn.WriteJSON(Envelope{Type: MessageError, ID: msg.ID, Error: fmt.Sprintf("unexpected message %q", msg.Type)})
			continue
		}
		if err := analyzeAndReply(ctx, conn, msg.ID, *msg.Query, engine, maxVisits); err != nil {
			return err
		}
	}
}

func analyzeAndReply(ctx context.Context, conn *websocket.Conn, id string, query katago.Query, engine katago.Analyzer, maxVisits int) error {
	if maxVisits > 0 {
		query.MaxVisits = maxVisits
	}
	writeResult := func(result katago.Result) {
		_ = conn.WriteJSON(Envelope{Type: MessageResult, ID: id, Result: &result})
	}
	// keep the existing analyzer dispatch below this line
}
```

- [ ] **Step 4: Replace worker command test**

Replace `cmd/jcgo-worker/main_test.go` with:

```go
package main

import (
	"bytes"
	"context"
	"errors"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"jcgo/internal/katago"
	"jcgo/internal/worker"
)

func TestRunReturnsErrorWhenSharedConfigIsMissing(t *testing.T) {
	err := run(context.Background(), runOptions{
		Dir:    t.TempDir(),
		Logger: log.New(&bytes.Buffer{}, "", 0),
		Sleep:  func(time.Duration) {},
	})
	if err == nil || !strings.Contains(err.Error(), "config file not found") {
		t.Fatalf("err = %v", err)
	}
}

func TestRunConnectsWithDerivedRuntimePathsAndMaxVisits(t *testing.T) {
	dir := t.TempDir()
	writeConfig(t, dir, `"model": "model.bin.gz"`)
	var gotKatago, gotModel, gotAnalysis string
	var gotInfo worker.Info
	var gotVisits int

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	err := run(ctx, runOptions{
		Dir:    dir,
		Logger: log.New(&bytes.Buffer{}, "", 0),
		StartLocal: func(ctx context.Context, katagoPath string, modelPath string, configPath string) (katago.Analyzer, error) {
			gotKatago, gotModel, gotAnalysis = katagoPath, modelPath, configPath
			return katago.NewUnavailable("stop after connect"), nil
		},
		ServeConnection: func(ctx context.Context, serverURL string, token string, info worker.Info, engine katago.Analyzer, maxVisits int) error {
			gotInfo = info
			gotVisits = maxVisits
			cancel()
			return context.Canceled
		},
		Sleep: func(time.Duration) {},
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
	if gotKatago != filepath.Join(dir, "bin", "katago.exe") {
		t.Fatalf("katago = %q", gotKatago)
	}
	if gotModel != filepath.Join(dir, "model", "model.bin.gz") {
		t.Fatalf("model = %q", gotModel)
	}
	if gotAnalysis != filepath.Join(dir, "config", "analysis_config.cfg") {
		t.Fatalf("analysis config = %q", gotAnalysis)
	}
	if gotInfo.Name != "local-gpu" || !gotInfo.Available || gotVisits != 700 {
		t.Fatalf("info=%#v visits=%d", gotInfo, gotVisits)
	}
}

func TestRunReportsUnavailableWhenWorkerModelIsEmpty(t *testing.T) {
	dir := t.TempDir()
	writeConfig(t, dir, `"model": ""`)
	var gotInfo worker.Info

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	err := run(ctx, runOptions{
		Dir:    dir,
		Logger: log.New(&bytes.Buffer{}, "", 0),
		StartLocal: func(context.Context, string, string, string) (katago.Analyzer, error) {
			t.Fatal("StartLocal should not be called without worker.model")
			return nil, nil
		},
		ServeConnection: func(ctx context.Context, serverURL string, token string, info worker.Info, engine katago.Analyzer, maxVisits int) error {
			gotInfo = info
			cancel()
			return context.Canceled
		},
		Sleep: func(time.Duration) {},
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
	if gotInfo.Available || !strings.Contains(gotInfo.Error, "worker.model is required") {
		t.Fatalf("info = %#v", gotInfo)
	}
}

func writeConfig(t *testing.T, dir string, modelLine string) {
	t.Helper()
	raw := `{
  "server": {"enabled": false, "port": 4380, "token": ""},
  "worker": {"enabled": true, "name": "local-gpu", "url": "ws://127.0.0.1:4380/worker", "token": "dev-token", ` + modelLine + `, "maxVisits": 700},
  "log": {"level": "warn"}
}`
	if err := os.WriteFile(filepath.Join(dir, "config.json"), []byte(raw), 0o644); err != nil {
		t.Fatal(err)
	}
}
```

- [ ] **Step 5: Run worker command tests to verify they fail**

Run: `go test ./cmd/jcgo-worker`

Expected: FAIL because `runOptions.ServeConnection` and config loading still use `jcgo-worker.json`.

- [ ] **Step 6: Update worker command to shared config**

In `cmd/jcgo-worker/main.go`, change `serveConnectionFunc` and config loading:

```go
type serveConnectionFunc func(context.Context, string, string, worker.Info, katago.Analyzer, int) error
```

Parse `--dir` in `main`:

```go
func main() {
	dirFlag := flag.String("dir", "", "JCGO home directory")
	_ = flag.CommandLine.Parse(os.Args[1:])
	dir := *dirFlag
	if dir == "" {
		var err error
		dir, err = config.DefaultDir()
		if err != nil {
			log.Fatal(err)
		}
	}
	cfg, err := config.LoadDir(dir)
	if err != nil {
		log.Fatal(err)
	}
	logFile, err := os.OpenFile(cfg.WorkerLogPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		log.Fatal(err)
	}
	defer logFile.Close()
	logger := log.New(io.MultiWriter(os.Stdout, logFile), "", log.LstdFlags)
	if err := run(context.Background(), runOptions{Dir: dir, Logger: logger}); err != nil {
		logger.Fatal(err)
	}
}
```

Inside `run`:

```go
cfg, err := config.LoadDir(opts.Dir)
if err != nil {
	return err
}
if !cfg.Worker.Enabled {
	opts.Logger.Printf("worker disabled in config")
	return nil
}

var engine katago.Analyzer
available := false
errorMessage := ""
if strings.TrimSpace(cfg.Worker.Model) == "" {
	errorMessage = "worker.model is required"
	engine = katago.NewUnavailable(errorMessage)
} else {
	started, engineErr := opts.StartLocal(ctx, cfg.KatagoPath, cfg.ModelPath, cfg.AnalysisConfigPath)
	if engineErr != nil {
		errorMessage = engineErr.Error()
		engine = katago.NewUnavailable(errorMessage)
		opts.Logger.Printf("katago unavailable: %v", engineErr)
	} else {
		engine = started
		available = true
		defer engine.Close()
	}
}

info := worker.Info{
	Name:               cfg.Worker.Name,
	Platform:           runtime.GOOS + "/" + runtime.GOARCH,
	KatagoPath:         cfg.KatagoPath,
	ModelPath:          cfg.ModelPath,
	AnalysisConfigPath: cfg.AnalysisConfigPath,
	Available:          available,
	Error:              errorMessage,
}
```

Call:

```go
err := opts.ServeConnection(ctx, cfg.Worker.URL, cfg.Worker.Token, info, engine, cfg.Worker.MaxVisits)
```

Remove `executableDir`, `worker.LoadOrCreateConfig`, and `strings.Join(missing)` logic.

- [ ] **Step 7: Run Worker tests**

Run: `go test ./internal/worker ./cmd/jcgo-worker`

Expected: PASS.

- [ ] **Step 8: Commit Worker runtime config**

```powershell
git add internal/worker/client.go internal/worker/client_test.go cmd/jcgo-worker/main.go cmd/jcgo-worker/main_test.go
git commit -m "Load worker from shared runtime config"
```

---

### Task 6: Server Command Uses Shared Config And Installed Web

**Files:**
- Modify: `cmd/jcgo/main.go`
- Add: `cmd/jcgo/main_test.go`

- [ ] **Step 1: Add command-level tests for disabled server and static dir wiring**

Create `cmd/jcgo/main_test.go` with a small testable config path helper:

```go
package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestConfigPathUsesDirFlag(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "state")
	got := configDirFromArgs([]string{"--dir", dir})
	if got != dir {
		t.Fatalf("dir = %q, want %q", got, dir)
	}
}

func TestConfigPathDefaultsToHomeJCGO(t *testing.T) {
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)
	got := configDirFromArgs(nil)
	if filepath.Base(got) != ".jcgo" {
		t.Fatalf("dir = %q", got)
	}
}

func TestServerDisabledReturnsWithoutListen(t *testing.T) {
	dir := t.TempDir()
	raw := []byte(`{
  "server": {"enabled": false, "port": 4380, "token": ""},
  "worker": {"enabled": false, "name": "", "url": "", "token": "", "model": "", "maxVisits": 500},
  "log": {"level": "warn"}
}`)
	if err := os.WriteFile(filepath.Join(dir, "config.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := run([]string{"--dir", dir}); err != nil {
		t.Fatalf("run returned error: %v", err)
	}
}
```

- [ ] **Step 2: Run command tests to verify they fail**

Run: `go test ./cmd/jcgo`

Expected: FAIL because `run` and `configDirFromArgs` do not exist.

- [ ] **Step 3: Refactor server command around shared config**

Replace `cmd/jcgo/main.go` with:

```go
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
```

- [ ] **Step 4: Run command tests**

Run: `go test ./cmd/jcgo`

Expected: PASS.

- [ ] **Step 5: Commit server command config**

```powershell
git add cmd/jcgo/main.go cmd/jcgo/main_test.go
git commit -m "Load server from shared runtime config"
```

---

### Task 7: Frontend Worker-only Settings UI

**Files:**
- Modify: `web/src/api/types.ts`
- Modify: `web/src/components/SettingsPage.tsx`
- Modify: `web/src/components/SettingsPage.test.tsx`
- Modify: `web/src/App.navigation.test.tsx`

- [ ] **Step 1: Update SettingsPage tests for Worker-only wording**

Replace `web/src/components/SettingsPage.test.tsx` with:

```tsx
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsPage } from './SettingsPage'

describe('SettingsPage', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders worker status with connected worker details', () => {
    render(
      <SettingsPage
        workerStatus={{
          connected: 1,
          available: 1,
          busy: 0,
          workers: [{
            id: 'worker-1',
            name: 'gpu-worker',
            platform: 'windows/amd64',
            available: true,
            busy: false,
          }],
        }}
        onBack={vi.fn()}
      />,
    )

    const section = screen.getByRole('region', { name: 'Worker 状态' })
    expect(section).toHaveTextContent('1 个 Worker，1 个可用，0 个忙碌')
    expect(section).not.toHaveTextContent('本机分析')
    expect(section).not.toHaveTextContent('远程连接')
    expect(within(section).getByText('gpu-worker')).toBeInTheDocument()
    expect(within(section).getByText('windows/amd64')).toBeInTheDocument()
  })

  it('shows an empty worker-only state', () => {
    render(
      <SettingsPage
        workerStatus={{ connected: 0, available: 0, busy: 0, workers: [] }}
        onBack={vi.fn()}
      />,
    )

    const section = screen.getByRole('region', { name: 'Worker 状态' })
    expect(within(section).getByText('未连接')).toBeInTheDocument()
    expect(within(section).getByText('暂无 Worker 连接')).toBeInTheDocument()
  })

  it('shows worker errors on the worker row', () => {
    render(
      <SettingsPage
        workerStatus={{
          connected: 1,
          available: 0,
          busy: 0,
          workers: [{
            id: 'worker-1',
            name: 'bad-worker',
            platform: 'windows/amd64',
            available: false,
            busy: false,
            error: 'worker.model is required',
          }],
        }}
        onBack={vi.fn()}
      />,
    )

    const section = screen.getByRole('region', { name: 'Worker 状态' })
    expect(within(section).getByText('不可用')).toBeInTheDocument()
    expect(within(section).getByText('worker.model is required')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run SettingsPage tests to verify they fail**

Run: `cd web; npm test -- --run src/components/SettingsPage.test.tsx`

Expected: FAIL because `WorkerStatus` still requires `local` and UI still renders local status.

- [ ] **Step 3: Remove local status type and UI**

In `web/src/api/types.ts`, remove `EngineStatus` and update `WorkerStatus`:

```ts
export interface WorkerStatus {
  connected: number
  available: number
  busy: number
  workers: WorkerRuntimeStatus[]
}
```

In `web/src/components/SettingsPage.tsx`, update `emptyWorkerStatus`:

```ts
const emptyWorkerStatus: WorkerStatus = {
  connected: 0,
  available: 0,
  busy: 0,
  workers: [],
}
```

Update status copy and grid:

```tsx
<small>{workerStatus.connected} 个 Worker，{workerStatus.available} 个可用，{workerStatus.busy} 个忙碌</small>
```

```tsx
<dl className="worker-status-grid">
  <div>
    <dt>连接</dt>
    <dd>{workerStatus.connected}</dd>
  </div>
  <div>
    <dt>可用 Worker</dt>
    <dd>{workerStatus.available}</dd>
  </div>
  <div>
    <dt>忙碌 Worker</dt>
    <dd>{workerStatus.busy}</dd>
  </div>
</dl>
```

Delete:

```tsx
{workerStatus.local.error && <p className="worker-status-error">{workerStatus.local.error}</p>}
```

Change empty text:

```tsx
<p className="worker-empty">暂无 Worker 连接</p>
```

- [ ] **Step 4: Update remaining frontend test fixtures**

Search:

Run: `rg -n "local: \\{ available" web/src --glob '!web/dist/**' --glob '!web/node_modules/**'`

Remove `local: { available: true },` from fixtures in `web/src/App.navigation.test.tsx` and any other frontend test file.

- [ ] **Step 5: Run frontend tests**

Run: `cd web; npm test -- --run src/components/SettingsPage.test.tsx src/App.navigation.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit frontend Worker-only UI**

```powershell
git add web/src/api/types.ts web/src/components/SettingsPage.tsx web/src/components/SettingsPage.test.tsx web/src/App.navigation.test.tsx
git commit -m "Show worker-only status in settings"
```

---

### Task 8: Cleanup Old Worker Config, Docs, And Build Scripts

**Files:**
- Delete: `internal/worker/config.go`
- Delete: `internal/worker/config_test.go`
- Delete: `scripts/build-worker.ps1`
- Delete: `configs/jcgo-worker.example.json`
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Delete old standalone worker config tests and script files**

Run:

```powershell
git rm internal/worker/config.go internal/worker/config_test.go scripts/build-worker.ps1 configs/jcgo-worker.example.json
```

Expected: files are staged for deletion.

- [ ] **Step 2: Update README runtime documentation**

Replace the Development and Remote Worker sections in `README.md` with:

````markdown
## Development

Backend tests:

```powershell
go test ./...
```

Frontend tests and build:

```powershell
cd web
npm test -- --run
npm run build
```

## Windows Deploy

Put optional runtime assets under `release-assets` before deploying:

```text
release-assets/
  katago.exe
  analysis_config.cfg
  model/
    your-model.bin.gz
```

Deploy from the repository root:

```powershell
.\deploy.bat
```

The deploy command installs to `~\.jcgo`, creates `config.json` only when it does not already exist, publishes Web assets, and writes `start.bat` / `stop.bat`.

Start JCGO:

```powershell
~\.jcgo\start.bat
```

Stop JCGO:

```powershell
~\.jcgo\stop.bat
```

Open `http://127.0.0.1:4380` and enter `server.token` from `~\.jcgo\config.json`.

JCGO uses Worker-only analysis. The server does not start KataGo directly. When `worker.enabled` is true, `jcgo-worker.exe` reads the same `config.json`, connects to `worker.url`, and starts KataGo from:

```text
~/.jcgo/bin/katago.exe
~/.jcgo/model/<worker.model>
~/.jcgo/config/analysis_config.cfg
```
````

- [ ] **Step 3: Update CLAUDE run instructions**

In `CLAUDE.md`, replace the old env-based "Run the server" block with:

````markdown
Run Windows deploy:

```powershell
.\deploy.bat
~\.jcgo\start.bat
```

Runtime config lives at `~\.jcgo\config.json`. The server uses `server.token`; the worker uses `worker.url`, `worker.token`, `worker.model`, and `worker.maxVisits`.
````

Keep the existing Completion Gate unchanged.

- [ ] **Step 4: Search for obsolete env and worker json references**

Run:

```powershell
rg -n "JCGO_ACCESS_TOKEN|JCGO_KATAGO_PATH|JCGO_MODEL_PATH|JCGO_ANALYSIS_CONFIG_PATH|JCGO_MAX_VISITS|jcgo-worker.json|build-worker.ps1|workerStatus\\.local|\\\"local\\\"" . --glob '!docs/scope/**' --glob '!web/dist/**' --glob '!web/node_modules/**' --glob '!node_modules/**'
```

Expected: no matches outside historical `docs/scope/**`.

- [ ] **Step 5: Run full Go tests**

Run: `go test ./...`

Expected: PASS.

- [ ] **Step 6: Commit cleanup and docs**

```powershell
git add -A
git commit -m "Document Windows worker-only runtime"
```

---

### Task 9: Final Verification And Windows Deploy Smoke

**Files:**
- No planned source edits unless verification exposes a failing requirement.

- [ ] **Step 1: Run backend tests**

Run: `go test ./...`

Expected: PASS.

- [ ] **Step 2: Run frontend tests**

Run:

```powershell
cd web
npm test -- --run
```

Expected: PASS.

- [ ] **Step 3: Run frontend build**

Run:

```powershell
cd web
npm run build
```

Expected: PASS and `web/dist` exists.

- [ ] **Step 4: Run deploy without release assets**

Run from repo root:

```powershell
.\deploy.bat
```

Expected:

- command exits 0
- `~\.jcgo\bin\jcgo.exe` exists
- `~\.jcgo\bin\jcgo-worker.exe` exists
- `~\.jcgo\web\index.html` exists
- `~\.jcgo\config.json` exists
- `~\.jcgo\start.bat` exists
- `~\.jcgo\stop.bat` exists
- existing `~\.jcgo\config.json` is not overwritten on a second `.\deploy.bat`

- [ ] **Step 5: Verify generated config parses**

Run:

```powershell
go test ./internal/config
```

Expected: PASS. Then inspect:

```powershell
Get-Content -Raw ~\.jcgo\config.json
```

Expected: JSON has `server`, `worker`, and `log` sections and no root `token`.

- [ ] **Step 6: Run obsolete reference scan**

Run:

```powershell
rg -n "JCGO_ACCESS_TOKEN|JCGO_KATAGO_PATH|JCGO_MODEL_PATH|JCGO_ANALYSIS_CONFIG_PATH|JCGO_MAX_VISITS|jcgo-worker.json|workerStatus\\.local|本机分析" . --glob '!docs/scope/**' --glob '!web/dist/**' --glob '!web/node_modules/**' --glob '!node_modules/**'
```

Expected: no matches outside historical docs.

- [ ] **Step 7: Final implementation tail required by CLAUDE**

Run this exact sequence on the implementation branch:

```powershell
git add -A
git commit -m "Add worker-only Windows runtime"
git push origin master
```

Expected: commit succeeds or reports nothing to commit only if every task commit has already included all changes; push succeeds.
