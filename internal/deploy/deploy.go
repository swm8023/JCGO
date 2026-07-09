package deploy

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
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
			return fmt.Errorf("pull latest source: %w", err)
		}
	}
	if err := createRuntimeDirs(opts); err != nil {
		return err
	}
	state := StateDir(opts)
	if err := runner.Run(ctx, opts.RepoRoot, "go", "build", "-o", filepath.Join(state, "bin", exeName("jcgo")), "./cmd/jcgo"); err != nil {
		return fmt.Errorf("build jcgo: %w", err)
	}
	if err := runner.Run(ctx, opts.RepoRoot, "go", "build", "-o", filepath.Join(state, "bin", exeName("jcgo-worker")), "./cmd/jcgo-worker"); err != nil {
		return fmt.Errorf("build jcgo-worker: %w", err)
	}
	if err := runner.Run(ctx, filepath.Join(opts.RepoRoot, "web"), "npm", "run", "build"); err != nil {
		return fmt.Errorf("build web: %w", err)
	}
	if err := copyWebDist(opts); err != nil {
		return err
	}
	if _, err := EnsureConfig(opts); err != nil {
		return err
	}
	if err := CopyReleaseAssets(opts); err != nil {
		return err
	}
	if err := WriteScripts(opts); err != nil {
		return err
	}
	return nil
}

func StateDir(opts Options) string {
	opts = resolve(opts)
	return filepath.Join(opts.HomeDir, ".jcgo")
}

func EnsureConfig(opts Options) (bool, error) {
	opts = resolve(opts)
	state := StateDir(opts)
	path := filepath.Join(state, "config.json")
	if _, err := os.Stat(path); err == nil {
		return false, ensureExistingConfigModel(opts, path)
	} else if !errors.Is(err, os.ErrNotExist) {
		return false, fmt.Errorf("stat config: %w", err)
	}
	if err := os.MkdirAll(state, 0o755); err != nil {
		return false, fmt.Errorf("create state dir: %w", err)
	}
	if err := os.WriteFile(path, config.DefaultFile(firstModel(opts)), 0o644); err != nil {
		return false, fmt.Errorf("write config: %w", err)
	}
	return true, nil
}

func ensureExistingConfigModel(opts Options, path string) error {
	model := firstModel(opts)
	if strings.TrimSpace(model) == "" {
		return nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read config: %w", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return fmt.Errorf("parse config for model update: %w", err)
	}
	workerConfig, ok := decoded["worker"].(map[string]any)
	if !ok {
		return nil
	}
	current, _ := workerConfig["model"].(string)
	if strings.TrimSpace(current) != "" {
		return nil
	}
	workerConfig["model"] = model
	updated, err := json.MarshalIndent(decoded, "", "  ")
	if err != nil {
		return fmt.Errorf("encode config model update: %w", err)
	}
	if err := os.WriteFile(path, append(updated, '\n'), 0o644); err != nil {
		return fmt.Errorf("write config model update: %w", err)
	}
	return nil
}

func CopyReleaseAssets(opts Options) error {
	opts = resolve(opts)
	state := StateDir(opts)
	assets := filepath.Join(opts.RepoRoot, "release-assets")
	if err := copyOptionalFile(filepath.Join(assets, "katago.exe"), filepath.Join(state, "bin", "katago.exe")); err != nil {
		return err
	}
	if err := copyOptionalFile(filepath.Join(assets, "analysis_config.cfg"), filepath.Join(state, "config", "analysis_config.cfg")); err != nil {
		return err
	}
	modelDir := filepath.Join(assets, "model")
	entries, err := os.ReadDir(modelDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("read model assets: %w", err)
	}
	for _, entry := range entries {
		if entry.IsDir() || entry.Name() == ".gitkeep" {
			continue
		}
		src := filepath.Join(modelDir, entry.Name())
		dst := filepath.Join(state, "model", entry.Name())
		if err := copyFile(src, dst); err != nil {
			return err
		}
	}
	return nil
}

func WriteScripts(opts Options) error {
	opts = resolve(opts)
	state := StateDir(opts)
	if err := os.MkdirAll(state, 0o755); err != nil {
		return fmt.Errorf("create state dir: %w", err)
	}
	start := startScript(state)
	stop := stopScript(state)
	if err := os.WriteFile(filepath.Join(state, "start.bat"), []byte(start), 0o644); err != nil {
		return fmt.Errorf("write start.bat: %w", err)
	}
	if err := os.WriteFile(filepath.Join(state, "stop.bat"), []byte(stop), 0o644); err != nil {
		return fmt.Errorf("write stop.bat: %w", err)
	}
	return nil
}

func resolve(opts Options) Options {
	if strings.TrimSpace(opts.RepoRoot) == "" {
		if cwd, err := os.Getwd(); err == nil {
			opts.RepoRoot = cwd
		}
	}
	if strings.TrimSpace(opts.HomeDir) == "" {
		if home, err := os.UserHomeDir(); err == nil {
			opts.HomeDir = home
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
	state := StateDir(opts)
	for _, dir := range []string{
		filepath.Join(state, "bin"),
		filepath.Join(state, "config"),
		filepath.Join(state, "db"),
		filepath.Join(state, "games"),
		filepath.Join(state, "log"),
		filepath.Join(state, "model"),
		filepath.Join(state, "web"),
	} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("create %s: %w", dir, err)
		}
	}
	return nil
}

func firstModel(opts Options) string {
	modelDir := filepath.Join(opts.RepoRoot, "release-assets", "model")
	entries, err := os.ReadDir(modelDir)
	if err != nil {
		return ""
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || entry.Name() == ".gitkeep" {
			continue
		}
		names = append(names, entry.Name())
	}
	sort.Strings(names)
	if len(names) == 0 {
		return ""
	}
	return names[0]
}

func copyWebDist(opts Options) error {
	src := filepath.Join(opts.RepoRoot, "web", "dist")
	dst := filepath.Join(StateDir(opts), "web")
	if err := replaceDir(dst); err != nil {
		return err
	}
	return copyDir(src, dst)
}

func replaceDir(path string) error {
	if err := os.RemoveAll(path); err != nil {
		return fmt.Errorf("remove %s: %w", path, err)
	}
	return os.MkdirAll(path, 0o755)
}

func copyDir(src string, dst string) error {
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		return copyFile(path, target)
	})
}

func copyOptionalFile(src string, dst string) error {
	if _, err := os.Stat(src); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("stat %s: %w", src, err)
	}
	return copyFile(src, dst)
}

func copyFile(src string, dst string) error {
	info, err := os.Stat(src)
	if err != nil {
		return fmt.Errorf("stat source %s: %w", src, err)
	}
	if info.IsDir() {
		return fmt.Errorf("source is a directory: %s", src)
	}
	in, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("open source %s: %w", src, err)
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return fmt.Errorf("create destination dir: %w", err)
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, info.Mode().Perm())
	if err != nil {
		return fmt.Errorf("open destination %s: %w", dst, err)
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return fmt.Errorf("copy %s to %s: %w", src, dst, err)
	}
	return nil
}

func startScript(state string) string {
	quotedState := psSingleQuote(filepath.Clean(state))
	return fmt.Sprintf(`@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; $dir = %s; $bin = Join-Path $dir 'bin'; Start-Process -FilePath (Join-Path $bin 'jcgo.exe') -ArgumentList @('--dir', $dir) -WorkingDirectory $dir -WindowStyle Hidden; Start-Process -FilePath (Join-Path $bin 'jcgo-worker.exe') -ArgumentList @('--dir', $dir) -WorkingDirectory $dir -WindowStyle Hidden"
exit /b %%ERRORLEVEL%%
`, quotedState)
}

func stopScript(state string) string {
	quotedState := psSingleQuote(filepath.Clean(state))
	return fmt.Sprintf(`@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; $dir = %s; $targets = @((Join-Path $dir 'bin\jcgo.exe'), (Join-Path $dir 'bin\jcgo-worker.exe')); Get-CimInstance Win32_Process | Where-Object { $targets -contains $_.ExecutablePath } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
exit /b %%ERRORLEVEL%%
`, quotedState)
}

func psSingleQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

func exeName(name string) string {
	if runtime.GOOS == "windows" && !strings.HasSuffix(name, ".exe") {
		return name + ".exe"
	}
	return name
}
