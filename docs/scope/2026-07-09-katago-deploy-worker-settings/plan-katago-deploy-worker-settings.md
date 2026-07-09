# KataGo Deploy And Worker Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single `deploy.bat` flow that stages downloads/build outputs before publishing, and add online Worker model/visit configuration from the settings page.

**Architecture:** The deploy path becomes manifest-driven: `internal/deploy` loads a repo manifest, downloads and stages assets under `release-assets`, builds binaries into staging, then publishes to `~\.jcgo` only after Stage succeeds. Worker runtime settings are owned by each Worker process, exposed through the existing worker WebSocket with new configure/status messages, and surfaced through `workspace.state` plus a `worker.configure` RPC.

**Tech Stack:** Go, Windows batch/PowerShell, Gorilla WebSocket, React/Vite, Vitest, Testing Library.

---

### Task 1: Add Deploy Manifest Schema

**Files:**
- Create: `release-assets/katago-manifest.json`
- Create: `internal/deploy/manifest.go`
- Create: `internal/deploy/manifest_test.go`
- Modify: `.gitignore`

- [ ] **Step 1: Write the manifest file**

Create `release-assets/katago-manifest.json`:

```json
{
  "katago": {
    "version": "v1.16.5",
    "publishBackend": "opencl",
    "backends": [
      {
        "id": "opencl",
        "label": "OpenCL",
        "archive": "katago-v1.16.5-opencl-windows-x64.zip",
        "url": "https://github.com/lightvector/KataGo/releases/download/v1.16.5/katago-v1.16.5-opencl-windows-x64.zip"
      },
      {
        "id": "cuda12.8",
        "label": "CUDA 12.8 / cuDNN 9.8.0",
        "archive": "katago-v1.16.5-cuda12.8-cudnn9.8.0-windows-x64.zip",
        "url": "https://github.com/lightvector/KataGo/releases/download/v1.16.5/katago-v1.16.5-cuda12.8-cudnn9.8.0-windows-x64.zip"
      }
    ]
  },
  "models": [
    {
      "id": "b18",
      "label": "b18 balanced",
      "filename": "kata1-b18c384nbt-s9996604416-d4316597426.bin.gz",
      "url": "https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-b18c384nbt-s9996604416-d4316597426.bin.gz"
    },
    {
      "id": "b28",
      "label": "b28 latest",
      "filename": "kata1-b28c512nbt-s13255194368-d5935380940.bin.gz",
      "url": "https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-b28c512nbt-s13255194368-d5935380940.bin.gz"
    },
    {
      "id": "zhizi",
      "label": "zhizi strongest",
      "filename": "kata1-zhizi-b40c768nbt-s11272M-d5935M.bin.gz",
      "url": "https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-zhizi-b40c768nbt-s11272M-d5935M.bin.gz"
    }
  ]
}
```

- [ ] **Step 2: Ignore generated staging/cache folders**

Modify `.gitignore`:

```gitignore
release-assets/cache/
release-assets/stage/
```

- [ ] **Step 3: Write failing manifest tests**

Create `internal/deploy/manifest_test.go`:

```go
package deploy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadManifestSelectsPublishBackend(t *testing.T) {
	repo := t.TempDir()
	path := filepath.Join(repo, "release-assets")
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatal(err)
	}
	raw := []byte(`{
	  "katago": {
	    "version": "v1.16.5",
	    "publishBackend": "opencl",
	    "backends": [
	      {"id": "opencl", "label": "OpenCL", "archive": "opencl.zip", "url": "https://example.test/opencl.zip"},
	      {"id": "cuda12.8", "label": "CUDA", "archive": "cuda.zip", "url": "https://example.test/cuda.zip"}
	    ]
	  },
	  "models": [
	    {"id": "b18", "label": "b18", "filename": "kata1-b18c384nbt-s9996604416-d4316597426.bin.gz", "url": "https://example.test/b18.bin.gz"}
	  ]
	}`)
	if err := os.WriteFile(filepath.Join(path, "katago-manifest.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}

	manifest, err := LoadManifest(Options{RepoRoot: repo})
	if err != nil {
		t.Fatalf("LoadManifest returned error: %v", err)
	}
	backend, ok := manifest.PublishBackend()
	if !ok || backend.ID != "opencl" || backend.Archive != "opencl.zip" {
		t.Fatalf("publish backend = %#v ok=%t", backend, ok)
	}
	if manifest.Models[0].Filename != DefaultWorkerModel {
		t.Fatalf("default model = %q", manifest.Models[0].Filename)
	}
}

func TestLoadManifestRejectsUnknownPublishBackend(t *testing.T) {
	repo := t.TempDir()
	path := filepath.Join(repo, "release-assets")
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatal(err)
	}
	raw := []byte(`{
	  "katago": {
	    "version": "v1.16.5",
	    "publishBackend": "missing",
	    "backends": [
	      {"id": "opencl", "label": "OpenCL", "archive": "opencl.zip", "url": "https://example.test/opencl.zip"}
	    ]
	  },
	  "models": [
	    {"id": "b18", "label": "b18", "filename": "kata1-b18c384nbt-s9996604416-d4316597426.bin.gz", "url": "https://example.test/b18.bin.gz"}
	  ]
	}`)
	if err := os.WriteFile(filepath.Join(path, "katago-manifest.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := LoadManifest(Options{RepoRoot: repo})
	if err == nil || !strings.Contains(err.Error(), "publishBackend missing") {
		t.Fatalf("err = %v", err)
	}
}
```

- [ ] **Step 4: Run manifest tests and verify failure**

Run:

```powershell
go test ./internal/deploy -run Manifest -count=1
```

Expected: compile failure for `LoadManifest` and `DefaultWorkerModel`.

- [ ] **Step 5: Implement manifest types and validation**

Create `internal/deploy/manifest.go`:

```go
package deploy

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const DefaultWorkerModel = "kata1-b18c384nbt-s9996604416-d4316597426.bin.gz"

type Manifest struct {
	Katago KatagoManifest `json:"katago"`
	Models []ModelAsset   `json:"models"`
}

type KatagoManifest struct {
	Version        string         `json:"version"`
	PublishBackend string        `json:"publishBackend"`
	Backends       []BackendAsset `json:"backends"`
}

type BackendAsset struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Archive string `json:"archive"`
	URL     string `json:"url"`
}

type ModelAsset struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Filename string `json:"filename"`
	URL      string `json:"url"`
}

func ManifestPath(opts Options) string {
	opts = resolve(opts)
	return filepath.Join(opts.RepoRoot, "release-assets", "katago-manifest.json")
}

func LoadManifest(opts Options) (Manifest, error) {
	data, err := os.ReadFile(ManifestPath(opts))
	if err != nil {
		return Manifest{}, fmt.Errorf("read manifest: %w", err)
	}
	var manifest Manifest
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&manifest); err != nil {
		return Manifest{}, fmt.Errorf("parse manifest: %w", err)
	}
	if err := manifest.Validate(); err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

func (m Manifest) Validate() error {
	if strings.TrimSpace(m.Katago.Version) == "" {
		return fmt.Errorf("manifest katago.version is required")
	}
	if strings.TrimSpace(m.Katago.PublishBackend) == "" {
		return fmt.Errorf("manifest katago.publishBackend is required")
	}
	if _, ok := m.PublishBackend(); !ok {
		return fmt.Errorf("manifest publishBackend %s not found", m.Katago.PublishBackend)
	}
	ids := map[string]bool{}
	for _, backend := range m.Katago.Backends {
		if strings.TrimSpace(backend.ID) == "" || strings.TrimSpace(backend.Archive) == "" || strings.TrimSpace(backend.URL) == "" {
			return fmt.Errorf("manifest backend entries require id, archive, and url")
		}
		if ids[backend.ID] {
			return fmt.Errorf("manifest backend %s is duplicated", backend.ID)
		}
		ids[backend.ID] = true
	}
	models := map[string]bool{}
	for _, model := range m.Models {
		if strings.TrimSpace(model.ID) == "" || strings.TrimSpace(model.Filename) == "" || strings.TrimSpace(model.URL) == "" {
			return fmt.Errorf("manifest model entries require id, filename, and url")
		}
		if models[model.Filename] {
			return fmt.Errorf("manifest model %s is duplicated", model.Filename)
		}
		models[model.Filename] = true
	}
	return nil
}

func (m Manifest) PublishBackend() (BackendAsset, bool) {
	for _, backend := range m.Katago.Backends {
		if backend.ID == m.Katago.PublishBackend {
			return backend, true
		}
	}
	return BackendAsset{}, false
}
```

- [ ] **Step 6: Run manifest tests and commit**

Run:

```powershell
go test ./internal/deploy -run Manifest -count=1
```

Expected: PASS.

Commit:

```powershell
git add .gitignore release-assets/katago-manifest.json internal/deploy/manifest.go internal/deploy/manifest_test.go
git commit -m "Add KataGo deploy manifest"
```

### Task 2: Stage KataGo And Model Assets

**Files:**
- Create: `internal/deploy/assets.go`
- Modify: `internal/deploy/deploy_test.go`

- [ ] **Step 1: Add failing tests for asset staging**

Append to `internal/deploy/deploy_test.go`:

```go
func TestStageReleaseAssetsDownloadsAndPublishesSelectedBackend(t *testing.T) {
	root := t.TempDir()
	repo := filepath.Join(root, "repo")
	home := filepath.Join(root, "home")
	if err := os.MkdirAll(filepath.Join(repo, "release-assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	openclZip := filepath.Join(root, "opencl.zip")
	cudaZip := filepath.Join(root, "cuda.zip")
	writeZip(t, openclZip, map[string]string{
		"katago.exe": "opencl-katago",
		"OpenCL.dll": "opencl-dll",
		"KataGoData/tune.txt": "opencl-tune",
	})
	writeZip(t, cudaZip, map[string]string{
		"katago.exe": "cuda-katago",
		"cudnn64_9.dll": "cuda-dll",
	})
	manifest := Manifest{
		Katago: KatagoManifest{
			Version: "v1.16.5", PublishBackend: "opencl",
			Backends: []BackendAsset{
				{ID: "opencl", Label: "OpenCL", Archive: "opencl.zip", URL: "file://" + openclZip},
				{ID: "cuda12.8", Label: "CUDA", Archive: "cuda.zip", URL: "file://" + cudaZip},
			},
		},
		Models: []ModelAsset{{ID: "b18", Filename: DefaultWorkerModel, URL: "file://" + filepath.Join(root, "b18.bin.gz")}},
	}
	if err := os.WriteFile(filepath.Join(root, "b18.bin.gz"), []byte("b18-model"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := StageReleaseAssets(context.Background(), Options{RepoRoot: repo, HomeDir: home}, manifest, FileDownloader{}); err != nil {
		t.Fatalf("StageReleaseAssets returned error: %v", err)
	}

	stage := StageDir(Options{RepoRoot: repo, HomeDir: home})
	assertFile(t, filepath.Join(stage, "publish", "bin", "katago.exe"), "opencl-katago")
	assertFile(t, filepath.Join(stage, "publish", "bin", "OpenCL.dll"), "opencl-dll")
	assertFile(t, filepath.Join(stage, "publish", "bin", "KataGoData", "tune.txt"), "opencl-tune")
	assertFile(t, filepath.Join(stage, "publish", "model", DefaultWorkerModel), "b18-model")
	assertFile(t, filepath.Join(stage, "publish", "config", "katago_backend.json"), "{\n  \"id\": \"opencl\",\n  \"label\": \"OpenCL\"\n}\n")
	if _, err := os.Stat(filepath.Join(home, ".jcgo")); !os.IsNotExist(err) {
		t.Fatalf("runtime dir was touched: %v", err)
	}
}
```

Add helper functions to the same test file:

```go
func writeZip(t *testing.T, path string, files map[string]string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	out, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer out.Close()
	zipWriter := zip.NewWriter(out)
	defer zipWriter.Close()
	for name, body := range files {
		w, err := zipWriter.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
}
```

Add imports:

```go
import (
	"archive/zip"
	"context"
)
```

- [ ] **Step 2: Run asset staging test and verify failure**

Run:

```powershell
go test ./internal/deploy -run StageReleaseAssets -count=1
```

Expected: compile failure for `StageReleaseAssets`, `StageDir`, and `FileDownloader`.

- [ ] **Step 3: Implement asset staging**

Create `internal/deploy/assets.go`:

```go
package deploy

import (
	"archive/zip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

type Downloader interface {
	Download(ctx context.Context, sourceURL string, dst string) error
}

type HTTPDownloader struct{}
type FileDownloader struct{}

func StageDir(opts Options) string {
	opts = resolve(opts)
	return filepath.Join(opts.RepoRoot, "release-assets", "stage")
}

func CacheDir(opts Options) string {
	opts = resolve(opts)
	return filepath.Join(opts.RepoRoot, "release-assets", "cache")
}

func StageReleaseAssets(ctx context.Context, opts Options, manifest Manifest, downloader Downloader) error {
	opts = resolve(opts)
	if downloader == nil {
		downloader = HTTPDownloader{}
	}
	stage := StageDir(opts)
	cache := CacheDir(opts)
	if err := replaceDir(stage); err != nil {
		return err
	}
	for _, backend := range manifest.Katago.Backends {
		archivePath := filepath.Join(cache, "katago", backend.Archive)
		if err := ensureDownloaded(ctx, downloader, backend.URL, archivePath); err != nil {
			return err
		}
		dst := filepath.Join(stage, "katago", backend.ID)
		if err := unzip(archivePath, dst); err != nil {
			return err
		}
	}
	backend, _ := manifest.PublishBackend()
	if err := copyDir(filepath.Join(stage, "katago", backend.ID), filepath.Join(stage, "publish", "bin")); err != nil {
		return err
	}
	for _, model := range manifest.Models {
		modelPath := filepath.Join(cache, "model", model.Filename)
		if err := ensureDownloaded(ctx, downloader, model.URL, modelPath); err != nil {
			return err
		}
		if err := copyFile(modelPath, filepath.Join(stage, "publish", "model", model.Filename)); err != nil {
			return err
		}
	}
	if err := writeBackendInfo(filepath.Join(stage, "publish", "config", "katago_backend.json"), backend); err != nil {
		return err
	}
	return copyOptionalFile(filepath.Join(opts.RepoRoot, "release-assets", "analysis_config.cfg"), filepath.Join(stage, "publish", "config", "analysis_config.cfg"))
}

func ensureDownloaded(ctx context.Context, downloader Downloader, sourceURL string, dst string) error {
	if _, err := os.Stat(dst); err == nil {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return fmt.Errorf("create cache dir: %w", err)
	}
	return downloader.Download(ctx, sourceURL, dst)
}

func (HTTPDownloader) Download(ctx context.Context, sourceURL string, dst string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("download %s: HTTP %d", sourceURL, resp.StatusCode)
	}
	return writeStream(dst, resp.Body)
}

func (FileDownloader) Download(ctx context.Context, sourceURL string, dst string) error {
	parsed, err := url.Parse(sourceURL)
	if err != nil {
		return err
	}
	src := parsed.Path
	if parsed.Scheme == "" {
		src = sourceURL
	}
	if strings.HasPrefix(src, "/") && len(src) >= 3 && src[2] == ':' {
		src = src[1:]
	}
	in, err := os.Open(filepath.FromSlash(src))
	if err != nil {
		return err
	}
	defer in.Close()
	return writeStream(dst, in)
}

func writeStream(dst string, in io.Reader) error {
	tmp := dst + ".tmp"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, in)
	closeErr := out.Close()
	if copyErr != nil {
		_ = os.Remove(tmp)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(tmp)
		return closeErr
	}
	return os.Rename(tmp, dst)
}

func unzip(src string, dst string) error {
	reader, err := zip.OpenReader(src)
	if err != nil {
		return fmt.Errorf("open zip %s: %w", src, err)
	}
	defer reader.Close()
	if err := replaceDir(dst); err != nil {
		return err
	}
	for _, file := range reader.File {
		target := filepath.Join(dst, filepath.Clean(file.Name))
		if !strings.HasPrefix(target, filepath.Clean(dst)+string(os.PathSeparator)) {
			return fmt.Errorf("zip entry escapes target: %s", file.Name)
		}
		if file.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		in, err := file.Open()
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			_ = in.Close()
			return err
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, file.FileInfo().Mode().Perm())
		if err != nil {
			_ = in.Close()
			return err
		}
		_, copyErr := io.Copy(out, in)
		closeOutErr := out.Close()
		closeInErr := in.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeOutErr != nil {
			return closeOutErr
		}
		if closeInErr != nil {
			return closeInErr
		}
	}
	return nil
}

func writeBackendInfo(path string, backend BackendAsset) error {
	data, err := json.MarshalIndent(struct {
		ID    string `json:"id"`
		Label string `json:"label"`
	}{ID: backend.ID, Label: backend.Label}, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o644)
}
```

- [ ] **Step 4: Run asset staging test and commit**

Run:

```powershell
go test ./internal/deploy -run StageReleaseAssets -count=1
```

Expected: PASS.

Commit:

```powershell
git add internal/deploy/assets.go internal/deploy/deploy_test.go
git commit -m "Stage KataGo release assets"
```

### Task 3: Split Deploy Into Stage And Publish

**Files:**
- Modify: `internal/deploy/deploy.go`
- Modify: `internal/deploy/deploy_test.go`

- [ ] **Step 1: Add failing tests for Stage/Publish boundary**

Append to `internal/deploy/deploy_test.go`:

```go
type recordingRunner struct {
	failOn string
	calls  []string
}

func (r *recordingRunner) Run(ctx context.Context, dir string, name string, args ...string) error {
	call := name + " " + strings.Join(args, " ")
	r.calls = append(r.calls, call)
	if r.failOn != "" && strings.Contains(call, r.failOn) {
		return errors.New("forced failure")
	}
	return nil
}

func TestDeployDoesNotPublishWhenStageBuildFails(t *testing.T) {
	root := t.TempDir()
	repo := filepath.Join(root, "repo")
	home := filepath.Join(root, "home")
	writeMinimalManifestAndStageFiles(t, repo)
	runner := &recordingRunner{failOn: "npm run build"}

	err := Deploy(context.Background(), Options{RepoRoot: repo, HomeDir: home, Runner: runner})
	if err == nil || !strings.Contains(err.Error(), "build web") {
		t.Fatalf("err = %v", err)
	}
	for _, call := range runner.calls {
		if strings.Contains(call, "stop.bat") {
			t.Fatalf("stop was called during failed stage: %v", runner.calls)
		}
	}
	if _, err := os.Stat(filepath.Join(home, ".jcgo")); !os.IsNotExist(err) {
		t.Fatalf("runtime dir was touched: %v", err)
	}
}

func TestDeployPublishesFromStageAfterSuccessfulBuild(t *testing.T) {
	root := t.TempDir()
	repo := filepath.Join(root, "repo")
	home := filepath.Join(root, "home")
	writeMinimalManifestAndStageFiles(t, repo)
	runner := &recordingRunner{}

	if err := Deploy(context.Background(), Options{RepoRoot: repo, HomeDir: home, Runner: runner}); err != nil {
		t.Fatalf("Deploy returned error: %v", err)
	}

	state := filepath.Join(home, ".jcgo")
	assertFile(t, filepath.Join(state, "bin", "katago.exe"), "opencl-katago")
	assertFile(t, filepath.Join(state, "model", DefaultWorkerModel), "b18-model")
	assertFile(t, filepath.Join(state, "config", "katago_backend.json"), "{\n  \"id\": \"opencl\",\n  \"label\": \"OpenCL\"\n}\n")
	if _, err := os.Stat(filepath.Join(state, "start.bat")); err != nil {
		t.Fatalf("start.bat missing: %v", err)
	}
}
```

Add helper:

```go
func writeMinimalManifestAndStageFiles(t *testing.T, repo string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(repo, "release-assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	openclZip := filepath.Join(repo, "release-assets", "opencl.zip")
	writeZip(t, openclZip, map[string]string{"katago.exe": "opencl-katago"})
	modelPath := filepath.Join(repo, "release-assets", "b18.bin.gz")
	if err := os.WriteFile(modelPath, []byte("b18-model"), 0o644); err != nil {
		t.Fatal(err)
	}
	raw := []byte(`{
	  "katago": {
	    "version": "v1.16.5",
	    "publishBackend": "opencl",
	    "backends": [
	      {"id": "opencl", "label": "OpenCL", "archive": "opencl.zip", "url": "file://` + filepath.ToSlash(openclZip) + `"}
	    ]
	  },
	  "models": [
	    {"id": "b18", "label": "b18", "filename": "` + DefaultWorkerModel + `", "url": "file://` + filepath.ToSlash(modelPath) + `"}
	  ]
	}`)
	if err := os.WriteFile(filepath.Join(repo, "release-assets", "katago-manifest.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(repo, "web", "dist"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "web", "dist", "index.html"), []byte("web"), 0o644); err != nil {
		t.Fatal(err)
	}
}
```

Add imports:

```go
import (
	"errors"
)
```

- [ ] **Step 2: Run deploy boundary tests and verify failure**

Run:

```powershell
go test ./internal/deploy -run Deploy -count=1
```

Expected: at least one failure because `Deploy` writes directly to `~\.jcgo`.

- [ ] **Step 3: Refactor Deploy into Stage and Publish functions**

Modify `internal/deploy/deploy.go`:

```go
type StagedRelease struct {
	Dir        string
	PublishDir string
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
	stage, err := Stage(ctx, opts, runner)
	if err != nil {
		return err
	}
	return Publish(ctx, opts, runner, stage)
}

func Stage(ctx context.Context, opts Options, runner Runner) (StagedRelease, error) {
	opts = resolve(opts)
	if runner == nil {
		runner = ExecRunner{}
	}
	manifest, err := LoadManifest(opts)
	if err != nil {
		return StagedRelease{}, err
	}
	if err := StageReleaseAssets(ctx, opts, manifest, nil); err != nil {
		return StagedRelease{}, err
	}
	stage := StageDir(opts)
	publish := filepath.Join(stage, "publish")
	if err := runner.Run(ctx, filepath.Join(opts.RepoRoot, "web"), "npm", "ci"); err != nil {
		return StagedRelease{}, fmt.Errorf("install web dependencies: %w", err)
	}
	if err := runner.Run(ctx, filepath.Join(opts.RepoRoot, "web"), "npm", "run", "build"); err != nil {
		return StagedRelease{}, fmt.Errorf("build web: %w", err)
	}
	if err := copyDir(filepath.Join(opts.RepoRoot, "web", "dist"), filepath.Join(publish, "web")); err != nil {
		return StagedRelease{}, err
	}
	if err := runner.Run(ctx, opts.RepoRoot, "go", "build", "-o", filepath.Join(publish, "bin", exeName("jcgo")), "./cmd/jcgo"); err != nil {
		return StagedRelease{}, fmt.Errorf("build jcgo: %w", err)
	}
	if err := runner.Run(ctx, opts.RepoRoot, "go", "build", "-o", filepath.Join(publish, "bin", exeName("jcgo-worker")), "./cmd/jcgo-worker"); err != nil {
		return StagedRelease{}, fmt.Errorf("build jcgo-worker: %w", err)
	}
	return StagedRelease{Dir: stage, PublishDir: publish}, nil
}

func Publish(ctx context.Context, opts Options, runner Runner, stage StagedRelease) error {
	opts = resolve(opts)
	if runner == nil {
		runner = ExecRunner{}
	}
	if err := stopExistingRuntime(ctx, opts, runner); err != nil {
		return err
	}
	if err := createRuntimeDirs(opts); err != nil {
		return err
	}
	for _, dir := range []string{
		filepath.Join(StateDir(opts), "bin"),
		filepath.Join(StateDir(opts), "config"),
		filepath.Join(StateDir(opts), "web"),
	} {
		if err := replaceDir(dir); err != nil {
			return err
		}
	}
	if err := copyDir(filepath.Join(stage.PublishDir, "bin"), filepath.Join(StateDir(opts), "bin")); err != nil {
		return err
	}
	if err := copyDir(filepath.Join(stage.PublishDir, "model"), filepath.Join(StateDir(opts), "model")); err != nil {
		return err
	}
	if err := copyDir(filepath.Join(stage.PublishDir, "config"), filepath.Join(StateDir(opts), "config")); err != nil {
		return err
	}
	if err := copyDir(filepath.Join(stage.PublishDir, "web"), filepath.Join(StateDir(opts), "web")); err != nil {
		return err
	}
	if _, err := EnsureConfig(opts); err != nil {
		return err
	}
	return WriteScripts(opts)
}
```

Replace `firstModel` with a default that does not depend on sorted release assets:

```go
func firstModel(opts Options) string {
	return DefaultWorkerModel
}
```

Implement `stopExistingRuntime` so first install does not fail:

```go
func stopExistingRuntime(ctx context.Context, opts Options, runner Runner) error {
	stop := filepath.Join(StateDir(opts), "stop.bat")
	if _, err := os.Stat(stop); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("stat stop script: %w", err)
	}
	return runner.Run(ctx, StateDir(opts), stop)
}
```

- [ ] **Step 4: Update tests affected by default model**

Modify `TestEnsureConfigCreatesDefaultWithFirstSortedModel` to assert the fixed default:

```go
if !strings.Contains(string(raw), `"model": "`+DefaultWorkerModel+`"`) {
	t.Fatalf("config = %s", raw)
}
```

Modify `TestEnsureConfigFillsEmptyExistingWorkerModel` the same way.

- [ ] **Step 5: Run deploy tests and commit**

Run:

```powershell
go test ./internal/deploy -count=1
```

Expected: PASS.

Commit:

```powershell
git add internal/deploy/deploy.go internal/deploy/deploy_test.go
git commit -m "Split deploy into stage and publish"
```

### Task 4: Harden deploy.bat Environment Checks

**Files:**
- Modify: `deploy.bat`
- Modify: `internal/deploy/deploy_test.go`

- [ ] **Step 1: Add script content test**

Append to `internal/deploy/deploy_test.go`:

```go
func TestRootDeployBatChecksGoNodeAndNpm(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "deploy.bat"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	for _, want := range []string{
		"Get-Command go",
		"Get-Command node",
		"Get-Command npm",
		"JCGO_DEPLOY_NO_PAUSE",
		"Log:",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("deploy.bat missing %q", want)
		}
	}
}
```

- [ ] **Step 2: Run script content test and verify failure**

Run:

```powershell
go test ./internal/deploy -run RootDeployBat -count=1
```

Expected: FAIL because `deploy.bat` does not check `node` or `npm`.

- [ ] **Step 3: Add Node and npm checks to deploy.bat**

Modify `deploy.bat` PowerShell payload:

```powershell
foreach ($tool in @("go", "node", "npm")) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "$tool was not found in PATH. Install $tool or run from a shell where $tool is available."
  }
}
```

Keep the existing temp stdout/stderr capture and `Read-Host` pause behavior.

- [ ] **Step 4: Run script content test and commit**

Run:

```powershell
go test ./internal/deploy -run RootDeployBat -count=1
```

Expected: PASS.

Commit:

```powershell
git add deploy.bat internal/deploy/deploy_test.go
git commit -m "Check deploy build tools"
```

### Task 5: Add Worker Runtime Config Store And Managed Analyzer

**Files:**
- Modify: `internal/config/config.go`
- Modify: `internal/config/config_test.go`
- Create: `internal/worker/runtime.go`
- Create: `internal/worker/runtime_test.go`

- [ ] **Step 1: Write failing config persistence test**

Append to `internal/config/config_test.go`:

```go
func TestUpdateWorkerRuntimePreservesSharedConfig(t *testing.T) {
	dir := t.TempDir()
	raw := []byte(`{
  "server": {"enabled": true, "port": 4380, "token": "server-token"},
  "worker": {"enabled": true, "name": "local-gpu", "url": "ws://127.0.0.1:4380/worker", "token": "worker-token", "model": "old.bin.gz", "maxVisits": 500},
  "log": {"level": "debug"}
}`)
	if err := os.WriteFile(filepath.Join(dir, "config.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}

	if err := UpdateWorkerRuntime(dir, "new.bin.gz", 1000); err != nil {
		t.Fatalf("UpdateWorkerRuntime returned error: %v", err)
	}
	cfg, err := LoadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Server.Token != "server-token" || cfg.Worker.Token != "worker-token" {
		t.Fatalf("config lost existing fields: %#v", cfg)
	}
	if cfg.Worker.Model != "new.bin.gz" || cfg.Worker.MaxVisits != 1000 {
		t.Fatalf("worker runtime = %#v", cfg.Worker)
	}
}
```

- [ ] **Step 2: Implement config updater and backend metadata loader**

Modify `internal/config/config.go`:

```go
type KatagoBackendInfo struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

func UpdateWorkerRuntime(dir string, model string, maxVisits int) error {
	cfg, err := readFileConfig(dir)
	if err != nil {
		return err
	}
	cfg.Worker.Model = model
	cfg.Worker.MaxVisits = maxVisits
	return writeFileConfig(dir, cfg)
}

func LoadKatagoBackendInfo(dir string) KatagoBackendInfo {
	path := filepath.Join(dir, "config", "katago_backend.json")
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
```

Add helper functions in the same file:

```go
func readFileConfig(dir string) (fileConfig, error) {
	path := filepath.Join(filepath.Clean(dir), "config.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return fileConfig{}, err
	}
	var raw fileConfig
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&raw); err != nil {
		return fileConfig{}, err
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
```

Refactor `LoadDir` to call `readFileConfig(dir)` before validation.

- [ ] **Step 3: Run config test**

Run:

```powershell
go test ./internal/config -run UpdateWorkerRuntime -count=1
```

Expected: PASS.

- [ ] **Step 4: Write failing Worker runtime tests**

Create `internal/worker/runtime_test.go`:

```go
package worker

import (
	"context"
	"io"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"jcgo/internal/katago"
)

type runtimeFakeEngine struct {
	queries []katago.Query
	closed  bool
}

func (e *runtimeFakeEngine) Analyze(ctx context.Context, query katago.Query) (katago.Result, error) {
	e.queries = append(e.queries, query)
	return katago.Result{ID: query.ID, RootInfo: katago.RootInfo{Visits: query.MaxVisits}}, nil
}

func (e *runtimeFakeEngine) Available() bool { return true }
func (e *runtimeFakeEngine) Status() katago.Status { return katago.Status{Available: true} }
func (e *runtimeFakeEngine) Close() error {
	e.closed = true
	return nil
}

func TestRuntimeUsesStoredMaxVisitsAndReportsInfo(t *testing.T) {
	dir := writeRuntimeConfig(t, "", "model.bin.gz", 700)
	engine := &runtimeFakeEngine{}
	runtime, err := NewRuntime(RuntimeOptions{
		Dir: dir,
		Logger: log.New(io.Discard, "", 0),
		StartLocal: func(context.Context, string, string, string) (katago.Analyzer, error) {
			return engine, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	result, err := runtime.Analyze(context.Background(), katago.Query{ID: "main:0", MaxVisits: 1})
	if err != nil {
		t.Fatal(err)
	}
	if result.RootInfo.Visits != 700 || engine.queries[0].MaxVisits != 700 {
		t.Fatalf("query visits = %#v result=%#v", engine.queries[0], result)
	}
	info := runtime.Info()
	if info.Model != "model.bin.gz" || info.MaxVisits != 700 || info.Backend != "opencl" {
		t.Fatalf("info = %#v", info)
	}
}

func TestRuntimeConfigurePersistsAndRestartsOnModelChange(t *testing.T) {
	dir := writeRuntimeConfig(t, "", "old.bin.gz", 500)
	starts := 0
	first := &runtimeFakeEngine{}
	second := &runtimeFakeEngine{}
	runtime, err := NewRuntime(RuntimeOptions{
		Dir: dir,
		Logger: log.New(io.Discard, "", 0),
		StartLocal: func(context.Context, string, string, string) (katago.Analyzer, error) {
			starts++
			if starts == 1 {
				return first, nil
			}
			return second, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	info, err := runtime.Configure(context.Background(), RuntimeConfig{Model: "new.bin.gz", MaxVisits: 900})
	if err != nil {
		t.Fatal(err)
	}
	if !first.closed || info.Model != "new.bin.gz" || info.MaxVisits != 900 {
		t.Fatalf("closed=%t info=%#v", first.closed, info)
	}
}
```

Add helper:

```go
func writeRuntimeConfig(t *testing.T, dir string, model string, maxVisits int) string {
	t.Helper()
	if dir == "" {
		dir = t.TempDir()
	}
	for _, path := range []string{
		filepath.Join(dir, "bin"),
		filepath.Join(dir, "config"),
		filepath.Join(dir, "model"),
	} {
		if err := os.MkdirAll(path, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	raw := []byte(`{
  "server": {"enabled": false, "port": 4380, "token": ""},
  "worker": {"enabled": true, "name": "local-gpu", "url": "ws://127.0.0.1:4380/worker", "token": "dev-token", "model": "` + model + `", "maxVisits": ` + strconv.Itoa(maxVisits) + `},
  "log": {"level": "warn"}
}`)
	if err := os.WriteFile(filepath.Join(dir, "config.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "config", "katago_backend.json"), []byte(`{"id":"opencl","label":"OpenCL"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}
```

Add imports used by the helper: `io`, `strconv`.

- [ ] **Step 5: Implement Worker runtime**

Create `internal/worker/runtime.go`:

```go
package worker

import (
	"context"
	"log"
	"path/filepath"
	"runtime"
	"sync"

	"jcgo/internal/config"
	"jcgo/internal/katago"
)

const defaultRuntimeModel = "kata1-b18c384nbt-s9996604416-d4316597426.bin.gz"

type RuntimeConfig struct {
	Model     string `json:"model"`
	MaxVisits int    `json:"maxVisits"`
}

type RuntimeOptions struct {
	Dir        string
	Logger     *log.Logger
	StartLocal func(context.Context, string, string, string) (katago.Analyzer, error)
}

type Runtime struct {
	mu         sync.Mutex
	dir        string
	logger     *log.Logger
	startLocal func(context.Context, string, string, string) (katago.Analyzer, error)
	engine     katago.Analyzer
	cfg        config.Config
	backend    config.KatagoBackendInfo
}

func NewRuntime(opts RuntimeOptions) (*Runtime, error) {
	if opts.Logger == nil {
		opts.Logger = log.Default()
	}
	if opts.StartLocal == nil {
		opts.StartLocal = katago.StartLocal
	}
	cfg, err := config.LoadDir(opts.Dir)
	if err != nil {
		return nil, err
	}
	if cfg.Worker.Model == "" {
		cfg.Worker.Model = defaultRuntimeModel
		cfg.ModelPath = filepath.Join(cfg.Dir, "model", cfg.Worker.Model)
	}
	r := &Runtime{
		dir: opts.Dir, logger: opts.Logger, startLocal: opts.StartLocal,
		cfg: cfg, backend: config.LoadKatagoBackendInfo(cfg.Dir),
	}
	if err := r.start(context.Background()); err != nil {
		r.engine = katago.NewUnavailable(err.Error())
	}
	return r, nil
}

func (r *Runtime) Info() Info {
	r.mu.Lock()
	defer r.mu.Unlock()
	status := r.engine.Status()
	return Info{
		Name: r.cfg.Worker.Name, Platform: runtime.GOOS + "/" + runtime.GOARCH,
		KatagoPath: r.cfg.KatagoPath, ModelPath: r.cfg.ModelPath, AnalysisConfigPath: r.cfg.AnalysisConfigPath,
		Backend: r.backend.ID, BackendLabel: r.backend.Label,
		Model: r.cfg.Worker.Model, MaxVisits: r.cfg.Worker.MaxVisits,
		Available: status.Available, Error: status.Error,
	}
}

func (r *Runtime) Analyze(ctx context.Context, query katago.Query) (katago.Result, error) {
	r.mu.Lock()
	query.MaxVisits = r.cfg.Worker.MaxVisits
	engine := r.engine
	r.mu.Unlock()
	return engine.Analyze(ctx, query)
}

func (r *Runtime) AnalyzeWithProgress(ctx context.Context, query katago.Query, progress func(katago.Result)) (katago.Result, error) {
	r.mu.Lock()
	query.MaxVisits = r.cfg.Worker.MaxVisits
	engine := r.engine
	r.mu.Unlock()
	if progressEngine, ok := engine.(katago.ProgressAnalyzer); ok {
		return progressEngine.AnalyzeWithProgress(ctx, query, progress)
	}
	return engine.Analyze(ctx, query)
}

func (r *Runtime) Configure(ctx context.Context, next RuntimeConfig) (Info, error) {
	r.mu.Lock()
	currentModel := r.cfg.Worker.Model
	r.cfg.Worker.Model = next.Model
	r.cfg.Worker.MaxVisits = next.MaxVisits
	r.cfg.ModelPath = filepath.Join(r.cfg.Dir, "model", next.Model)
	old := r.engine
	r.mu.Unlock()

	if err := config.UpdateWorkerRuntime(r.dir, next.Model, next.MaxVisits); err != nil {
		return r.Info(), err
	}
	if currentModel != next.Model {
		_ = old.Close()
		r.mu.Lock()
		err := r.start(ctx)
		r.mu.Unlock()
		if err != nil {
			return r.Info(), err
		}
	}
	return r.Info(), nil
}

func (r *Runtime) start(ctx context.Context) error {
	engine, err := r.startLocal(ctx, r.cfg.KatagoPath, r.cfg.ModelPath, r.cfg.AnalysisConfigPath)
	if err != nil {
		r.engine = katago.NewUnavailable(err.Error())
		return err
	}
	r.engine = engine
	return nil
}

func (r *Runtime) Close() error {
	r.mu.Lock()
	engine := r.engine
	r.mu.Unlock()
	return engine.Close()
}
```

- [ ] **Step 6: Run config and runtime tests and commit**

Run:

```powershell
go test ./internal/config ./internal/worker -run "UpdateWorkerRuntime|Runtime" -count=1
```

Expected: PASS.

Commit:

```powershell
git add internal/config/config.go internal/config/config_test.go internal/worker/runtime.go internal/worker/runtime_test.go
git commit -m "Add worker runtime configuration"
```

### Task 6: Extend Worker WebSocket Protocol For Configure And Status

**Files:**
- Modify: `internal/worker/protocol.go`
- Modify: `internal/worker/client.go`
- Modify: `internal/worker/client_test.go`
- Modify: `internal/worker/pool.go`
- Modify: `internal/worker/pool_test.go`

- [ ] **Step 1: Add protocol fields**

Modify `internal/worker/protocol.go`:

```go
const (
	MessageRegister  = "register"
	MessageAnalyze   = "analyze"
	MessageConfigure = "configure"
	MessageStatus    = "status"
	MessageResult    = "result"
	MessageError     = "error"
)

type Info struct {
	Name               string `json:"name"`
	Platform           string `json:"platform"`
	KatagoPath         string `json:"katagoPath"`
	ModelPath          string `json:"modelPath"`
	AnalysisConfigPath string `json:"analysisConfigPath"`
	Backend            string `json:"backend,omitempty"`
	BackendLabel       string `json:"backendLabel,omitempty"`
	Model              string `json:"model,omitempty"`
	MaxVisits          int    `json:"maxVisits,omitempty"`
	Available          bool   `json:"available"`
	Error              string `json:"error,omitempty"`
}

type Envelope struct {
	Type   string         `json:"type"`
	ID     string         `json:"id,omitempty"`
	Worker *Info          `json:"worker,omitempty"`
	Config *RuntimeConfig `json:"config,omitempty"`
	Query  *katago.Query  `json:"query,omitempty"`
	Result *katago.Result `json:"result,omitempty"`
	Error  string         `json:"error,omitempty"`
}
```

- [ ] **Step 2: Write failing client configure test**

Replace `TestServeConnectionAppliesWorkerMaxVisits` with:

```go
func TestServeConnectionConfiguresRuntimeAndUsesRuntimeVisits(t *testing.T) {
	server, connCh := testWorkerServer(t)
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runtime := &clientRecordingRuntime{
		info: Info{Name: "worker-1", Model: "old.bin.gz", MaxVisits: 700, Available: true},
		queries: make(chan katago.Query, 1),
	}
	go func() {
		_ = ServeConnection(ctx, "ws"+server.URL[len("http"):], "secret", runtime)
	}()

	conn := <-connCh
	defer conn.Close()
	var register Envelope
	if err := conn.ReadJSON(&register); err != nil {
		t.Fatal(err)
	}
	if err := conn.WriteJSON(Envelope{Type: MessageConfigure, ID: "cfg-1", Config: &RuntimeConfig{Model: "new.bin.gz", MaxVisits: 900}}); err != nil {
		t.Fatal(err)
	}
	var status Envelope
	if err := conn.ReadJSON(&status); err != nil {
		t.Fatal(err)
	}
	if status.Type != MessageStatus || status.Worker == nil || status.Worker.Model != "new.bin.gz" || status.Worker.MaxVisits != 900 {
		t.Fatalf("status = %#v", status)
	}
	if err := conn.WriteJSON(Envelope{Type: MessageAnalyze, ID: "job-3", Query: &katago.Query{ID: "main:2", MaxVisits: 1}}); err != nil {
		t.Fatal(err)
	}
	query := <-runtime.queries
	if query.MaxVisits != 900 {
		t.Fatalf("MaxVisits = %d", query.MaxVisits)
	}
}
```

Add test runtime:

```go
type clientRecordingRuntime struct {
	info    Info
	queries chan katago.Query
}

func (r *clientRecordingRuntime) Info() Info { return r.info }
func (r *clientRecordingRuntime) Configure(ctx context.Context, cfg RuntimeConfig) (Info, error) {
	r.info.Model = cfg.Model
	r.info.MaxVisits = cfg.MaxVisits
	return r.info, nil
}
func (r *clientRecordingRuntime) Analyze(ctx context.Context, query katago.Query) (katago.Result, error) {
	query.MaxVisits = r.info.MaxVisits
	r.queries <- query
	return katago.Result{ID: query.ID, RootInfo: katago.RootInfo{Visits: query.MaxVisits}}, nil
}
func (r *clientRecordingRuntime) AnalyzeWithProgress(ctx context.Context, query katago.Query, progress func(katago.Result)) (katago.Result, error) {
	return r.Analyze(ctx, query)
}
```

- [ ] **Step 3: Refactor ServeConnection to use runtime interface**

Modify `internal/worker/client.go`:

```go
type ClientRuntime interface {
	Info() Info
	Configure(context.Context, RuntimeConfig) (Info, error)
	Analyze(context.Context, katago.Query) (katago.Result, error)
}

type ClientProgressRuntime interface {
	AnalyzeWithProgress(context.Context, katago.Query, func(katago.Result)) (katago.Result, error)
}

func ServeConnection(ctx context.Context, serverURL string, accessToken string, runtime ClientRuntime) error {
	dialer := websocket.Dialer{Subprotocols: []string{Subprotocol, "token." + accessToken}}
	conn, _, err := dialer.DialContext(ctx, serverURL, nil)
	if err != nil {
		return err
	}
	defer conn.Close()

	info := runtime.Info()
	if err := conn.WriteJSON(Envelope{Type: MessageRegister, Worker: &info}); err != nil {
		return err
	}

	for {
		var msg Envelope
		if err := conn.ReadJSON(&msg); err != nil {
			return err
		}
		switch msg.Type {
		case MessageAnalyze:
			if msg.Query == nil {
				_ = conn.WriteJSON(Envelope{Type: MessageError, ID: msg.ID, Error: "analyze query is required"})
				continue
			}
			if err := analyzeAndReply(ctx, conn, msg.ID, *msg.Query, runtime); err != nil {
				return err
			}
		case MessageConfigure:
			if msg.Config == nil {
				_ = conn.WriteJSON(Envelope{Type: MessageError, ID: msg.ID, Error: "configure config is required"})
				continue
			}
			info, err := runtime.Configure(ctx, *msg.Config)
			if err != nil {
				_ = conn.WriteJSON(Envelope{Type: MessageError, ID: msg.ID, Error: err.Error()})
				continue
			}
			_ = conn.WriteJSON(Envelope{Type: MessageStatus, ID: msg.ID, Worker: &info})
		default:
			_ = conn.WriteJSON(Envelope{Type: MessageError, ID: msg.ID, Error: fmt.Sprintf("unexpected message %q", msg.Type)})
		}
	}
}
```

Update `analyzeAndReply` to call `runtime` without an extra `maxVisits` parameter.

- [ ] **Step 4: Update existing client tests to use test runtimes**

Replace calls like:

```go
ServeConnection(ctx, url, "secret", Info{Name: "worker-1", Available: true}, clientBasicAnalyzer{}, 0)
```

with:

```go
ServeConnection(ctx, url, "secret", staticClientRuntime{info: Info{Name: "worker-1", Available: true}, analyzer: clientBasicAnalyzer{}})
```

Add helper:

```go
type staticClientRuntime struct {
	info     Info
	analyzer katago.Analyzer
}

func (r staticClientRuntime) Info() Info { return r.info }
func (r staticClientRuntime) Configure(context.Context, RuntimeConfig) (Info, error) { return r.info, nil }
func (r staticClientRuntime) Analyze(ctx context.Context, query katago.Query) (katago.Result, error) {
	return r.analyzer.Analyze(ctx, query)
}
```

- [ ] **Step 5: Add failing pool configure tests**

Append to `internal/worker/pool_test.go`:

```go
func TestPoolConfiguresOnlineWorker(t *testing.T) {
	pool := NewPool(log.New(io.Discard, "", 0))
	serverURL, closeServer := servePool(t, pool)
	defer closeServer()

	go runConfigurableFakeWorker(t, serverURL)
	waitForWorkers(t, pool, 1)

	status, err := pool.ConfigureWorker(context.Background(), "worker-1", RuntimeConfig{Model: "new.bin.gz", MaxVisits: 900})
	if err != nil {
		t.Fatalf("ConfigureWorker returned error: %v", err)
	}
	if status.Workers[0].Model != "new.bin.gz" || status.Workers[0].MaxVisits != 900 {
		t.Fatalf("status = %#v", status)
	}
}
```

Add helper:

```go
func runConfigurableFakeWorker(t *testing.T, url string) {
	t.Helper()
	dialer := websocket.Dialer{Subprotocols: []string{Subprotocol}}
	conn, _, err := dialer.Dial(url, nil)
	if err != nil {
		t.Error(err)
		return
	}
	defer conn.Close()
	info := Info{Name: "test-worker", Platform: "windows/amd64", Backend: "opencl", Model: "old.bin.gz", MaxVisits: 500, Available: true}
	if err := conn.WriteJSON(Envelope{Type: MessageRegister, Worker: &info}); err != nil {
		t.Error(err)
		return
	}
	var msg Envelope
	if err := conn.ReadJSON(&msg); err != nil {
		t.Error(err)
		return
	}
	info.Model = msg.Config.Model
	info.MaxVisits = msg.Config.MaxVisits
	if err := conn.WriteJSON(Envelope{Type: MessageStatus, ID: msg.ID, Worker: &info}); err != nil {
		t.Error(err)
	}
}
```

- [ ] **Step 6: Implement pool configure and status fields**

Modify `RuntimeStatus`:

```go
type RuntimeStatus struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Platform     string `json:"platform"`
	Backend      string `json:"backend,omitempty"`
	BackendLabel string `json:"backendLabel,omitempty"`
	Model        string `json:"model,omitempty"`
	MaxVisits    int    `json:"maxVisits,omitempty"`
	Available    bool   `json:"available"`
	Busy         bool   `json:"busy"`
	Error        string `json:"error,omitempty"`
}
```

Add method to `Pool`:

```go
func (p *Pool) ConfigureWorker(ctx context.Context, id string, cfg RuntimeConfig) (StatusSnapshot, error) {
	worker := p.workerByID(id)
	if worker == nil {
		return p.StatusSnapshot(), fmt.Errorf("worker %s not connected", id)
	}
	replyID := fmt.Sprintf("cfg-%d", atomic.AddUint64(&p.seq, 1))
	ch := make(chan Envelope, 1)
	p.mu.Lock()
	worker.responses[replyID] = ch
	p.mu.Unlock()
	defer func() {
		p.mu.Lock()
		delete(worker.responses, replyID)
		p.mu.Unlock()
	}()
	worker.writeMu.Lock()
	err := worker.conn.WriteJSON(Envelope{Type: MessageConfigure, ID: replyID, Config: &cfg})
	worker.writeMu.Unlock()
	if err != nil {
		return p.StatusSnapshot(), err
	}
	select {
	case <-ctx.Done():
		return p.StatusSnapshot(), ctx.Err()
	case msg, ok := <-ch:
		if !ok {
			return p.StatusSnapshot(), errors.New("worker disconnected")
		}
		if msg.Type == MessageError {
			return p.StatusSnapshot(), errors.New(msg.Error)
		}
		if msg.Type != MessageStatus || msg.Worker == nil {
			return p.StatusSnapshot(), fmt.Errorf("unexpected worker message %q", msg.Type)
		}
		p.mu.Lock()
		worker.info = *msg.Worker
		p.mu.Unlock()
		return p.StatusSnapshot(), nil
	}
}
```

Add helper:

```go
func (p *Pool) workerByID(id string) *remoteWorker {
	p.mu.Lock()
	defer p.mu.Unlock()
	worker := p.ws[id]
	if worker == nil || worker.closed {
		return nil
	}
	return worker
}
```

Copy `Backend`, `BackendLabel`, `Model`, and `MaxVisits` in `StatusSnapshot`.

- [ ] **Step 7: Run worker tests and commit**

Run:

```powershell
go test ./internal/worker -count=1
```

Expected: PASS.

Commit:

```powershell
git add internal/worker/protocol.go internal/worker/client.go internal/worker/client_test.go internal/worker/pool.go internal/worker/pool_test.go
git commit -m "Add worker configure protocol"
```

### Task 7: Wire Runtime Into jcgo-worker

**Files:**
- Modify: `cmd/jcgo-worker/main.go`
- Modify: `cmd/jcgo-worker/main_test.go`

- [ ] **Step 1: Update worker command tests**

Replace `serveConnectionFunc` in `cmd/jcgo-worker/main.go` and tests with:

```go
type serveConnectionFunc func(context.Context, string, string, worker.ClientRuntime) error
```

Update `TestRunConnectsWithDerivedRuntimePathsAndMaxVisits` into `TestRunConnectsWithRuntimeInfo`:

```go
ServeConnection: func(ctx context.Context, serverURL string, token string, runtime worker.ClientRuntime) error {
	info := runtime.Info()
	gotInfo = info
	cancel()
	return context.Canceled
},
```

Assert:

```go
if gotInfo.Name != "local-gpu" || gotInfo.Model != "model.bin.gz" || gotInfo.MaxVisits != 700 || !gotInfo.Available {
	t.Fatalf("info=%#v", gotInfo)
}
```

- [ ] **Step 2: Run command tests and verify failure**

Run:

```powershell
go test ./cmd/jcgo-worker -count=1
```

Expected: compile failure because `run` still builds a raw analyzer and calls the old `ServeConnection` signature.

- [ ] **Step 3: Refactor run to create worker.Runtime**

Modify `cmd/jcgo-worker/main.go`:

```go
type startLocalFunc func(context.Context, string, string, string) (katago.Analyzer, error)
type serveConnectionFunc func(context.Context, string, string, worker.ClientRuntime) error
```

Inside `run`, replace the manual engine startup block with:

```go
runtime, err := worker.NewRuntime(worker.RuntimeOptions{
	Dir: opts.Dir,
	Logger: opts.Logger,
	StartLocal: opts.StartLocal,
})
if err != nil {
	return err
}
defer runtime.Close()

for {
	if err := ctx.Err(); err != nil {
		return err
	}
	cfg, err := config.LoadDir(opts.Dir)
	if err != nil {
		return err
	}
	opts.Logger.Printf("connecting to %s as %s", cfg.Worker.URL, cfg.Worker.Name)
	err = opts.ServeConnection(ctx, cfg.Worker.URL, cfg.Worker.Token, runtime)
	if errors.Is(err, context.Canceled) {
		return err
	}
	opts.Logger.Printf("connection ended: %v", err)
	opts.Sleep(5 * time.Second)
}
```

- [ ] **Step 4: Run command tests and commit**

Run:

```powershell
go test ./cmd/jcgo-worker -count=1
```

Expected: PASS.

Commit:

```powershell
git add cmd/jcgo-worker/main.go cmd/jcgo-worker/main_test.go
git commit -m "Use managed worker runtime"
```

### Task 8: Add worker.configure RPC

**Files:**
- Modify: `internal/app/handlers.go`
- Modify: `internal/app/handlers_test.go`
- Modify: `internal/app/app.go`

- [ ] **Step 1: Add failing handler test**

Append to `internal/app/handlers_test.go`:

```go
func TestWorkerConfigureCallsWorkerConfigurator(t *testing.T) {
	dir := t.TempDir()
	repo, err := store.Open(context.Background(), filepath.Join(dir, "db.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	configurator := &fakeWorkerConfigurator{status: worker.StatusSnapshot{
		Connected: 1, Available: 1,
		Workers: []worker.RuntimeStatus{{ID: "worker-1", Name: "gpu", Available: true, Model: "old.bin.gz", MaxVisits: 500}},
	}}
	handler := NewHandlerWithOptions(repo, store.NewFileStore(filepath.Join(dir, "games")), NewWorkspaceStore(), nil, HandlerOptions{
		WorkerStatusProvider: configurator,
		WorkerConfigurator: configurator,
	})

	result, err := handler.Call(context.Background(), "secret", "worker.configure", json.RawMessage(`{"workerId":"worker-1","model":"new.bin.gz","maxVisits":900}`))
	if err != nil {
		t.Fatalf("worker.configure returned error: %v", err)
	}
	status := result.(worker.StatusSnapshot)
	if configurator.gotID != "worker-1" || configurator.gotConfig.Model != "new.bin.gz" || configurator.gotConfig.MaxVisits != 900 {
		t.Fatalf("configure call = %q %#v", configurator.gotID, configurator.gotConfig)
	}
	if status.Workers[0].Model != "new.bin.gz" {
		t.Fatalf("status = %#v", status)
	}
}
```

Add fake:

```go
type fakeWorkerConfigurator struct {
	status worker.StatusSnapshot
	gotID string
	gotConfig worker.RuntimeConfig
}

func (f *fakeWorkerConfigurator) StatusSnapshot() worker.StatusSnapshot {
	return f.status
}

func (f *fakeWorkerConfigurator) ConfigureWorker(ctx context.Context, id string, cfg worker.RuntimeConfig) (worker.StatusSnapshot, error) {
	f.gotID = id
	f.gotConfig = cfg
	f.status.Workers[0].Model = cfg.Model
	f.status.Workers[0].MaxVisits = cfg.MaxVisits
	return f.status, nil
}
```

- [ ] **Step 2: Run handler test and verify failure**

Run:

```powershell
go test ./internal/app -run WorkerConfigure -count=1
```

Expected: compile failure for `WorkerConfigurator` or runtime error `method not found`.

- [ ] **Step 3: Implement RPC interface and params**

Modify `internal/app/handlers.go`:

```go
type WorkerConfigurator interface {
	ConfigureWorker(context.Context, string, worker.RuntimeConfig) (worker.StatusSnapshot, error)
}

type Handler struct {
	repo         *store.Repository
	files        store.FileStore
	workspaces   *WorkspaceStore
	analysis     AnalysisController
	workerStatus WorkerStatusProvider
	workerConfig WorkerConfigurator
	yuanluobo    YuanluoboBackend
}

type HandlerOptions struct {
	YuanluoboAuthStore   YuanluoboAuthStore
	YuanluoboHTTPClient  *http.Client
	YuanluoboBaseURL     string
	WorkerStatusProvider WorkerStatusProvider
	WorkerConfigurator   WorkerConfigurator
}
```

Set the field in `NewHandlerWithOptions`:

```go
h := &Handler{repo: repo, files: files, workspaces: workspaces, analysis: analysis, workerStatus: opts.WorkerStatusProvider, workerConfig: opts.WorkerConfigurator, yuanluobo: ylb}
```

Add switch case:

```go
case "worker.configure":
	return h.configureWorker(ctx, params)
```

Add params and method:

```go
type workerConfigureParams struct {
	WorkerID  string `json:"workerId"`
	Model     string `json:"model"`
	MaxVisits int    `json:"maxVisits"`
}

func (h *Handler) configureWorker(ctx context.Context, params json.RawMessage) (worker.StatusSnapshot, error) {
	if h.workerConfig == nil {
		return worker.StatusSnapshot{}, errors.New("worker configuration is unavailable")
	}
	var in workerConfigureParams
	if err := decodeParams(params, &in); err != nil {
		return worker.StatusSnapshot{}, err
	}
	if strings.TrimSpace(in.WorkerID) == "" {
		return worker.StatusSnapshot{}, errors.New("workerId is required")
	}
	if strings.TrimSpace(in.Model) == "" {
		return worker.StatusSnapshot{}, errors.New("model is required")
	}
	if in.MaxVisits <= 0 {
		return worker.StatusSnapshot{}, errors.New("maxVisits must be positive")
	}
	return h.workerConfig.ConfigureWorker(ctx, in.WorkerID, worker.RuntimeConfig{Model: in.Model, MaxVisits: in.MaxVisits})
}
```

Modify `internal/app/app.go` to pass the pool:

```go
WorkerStatusProvider: workers,
WorkerConfigurator: workers,
```

- [ ] **Step 4: Run handler tests and commit**

Run:

```powershell
go test ./internal/app -run "WorkerConfigure|WorkspaceStateIncludesWorkerStatus" -count=1
```

Expected: PASS.

Commit:

```powershell
git add internal/app/handlers.go internal/app/handlers_test.go internal/app/app.go
git commit -m "Add worker configure RPC"
```

### Task 9: Build Settings Page Worker Controls

**Files:**
- Modify: `web/src/api/types.ts`
- Modify: `web/src/components/SettingsPage.tsx`
- Modify: `web/src/components/SettingsPage.test.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/styles.css`

- [ ] **Step 1: Extend frontend types**

Modify `web/src/api/types.ts`:

```ts
export interface WorkerRuntimeStatus {
  id: string
  name: string
  platform: string
  backend?: string
  backendLabel?: string
  model?: string
  maxVisits?: number
  available: boolean
  busy: boolean
  error?: string
}

export interface WorkerConfigureInput {
  workerId: string
  model: string
  maxVisits: number
}
```

- [ ] **Step 2: Add failing settings page tests**

Append to `web/src/components/SettingsPage.test.tsx`:

```tsx
it('configures an online worker model and visits', async () => {
  const onConfigureWorker = vi.fn().mockResolvedValue(undefined)
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
          backend: 'opencl',
          backendLabel: 'OpenCL',
          model: 'kata1-b18c384nbt-s9996604416-d4316597426.bin.gz',
          maxVisits: 500,
          available: true,
          busy: false,
        }],
      }}
      onBack={vi.fn()}
      onConfigureWorker={onConfigureWorker}
    />,
  )

  await userEvent.selectOptions(screen.getByLabelText('模型'), 'kata1-b28c512nbt-s13255194368-d5935380940.bin.gz')
  await userEvent.clear(screen.getByLabelText('Visits'))
  await userEvent.type(screen.getByLabelText('Visits'), '900')
  await userEvent.click(screen.getByRole('button', { name: '保存' }))

  expect(onConfigureWorker).toHaveBeenCalledWith({
    workerId: 'worker-1',
    model: 'kata1-b28c512nbt-s13255194368-d5935380940.bin.gz',
    maxVisits: 900,
  })
})
```

Add import:

```ts
import userEvent from '@testing-library/user-event'
```

- [ ] **Step 3: Run settings test and verify failure**

Run:

```powershell
cd web
npm test -- --run src/components/SettingsPage.test.tsx
```

Expected: compile failure for missing `onConfigureWorker` prop or missing controls.

- [ ] **Step 4: Implement settings controls**

Modify `web/src/components/SettingsPage.tsx`:

```tsx
import { useState } from 'react'
import type { WorkerConfigureInput, WorkerRuntimeStatus, WorkerStatus } from '../api/types'

const workerModels = [
  { label: 'b18 balanced', filename: 'kata1-b18c384nbt-s9996604416-d4316597426.bin.gz' },
  { label: 'b28 latest', filename: 'kata1-b28c512nbt-s13255194368-d5935380940.bin.gz' },
  { label: 'zhizi strongest', filename: 'kata1-zhizi-b40c768nbt-s11272M-d5935M.bin.gz' },
]

interface SettingsPageProps {
  workerStatus?: WorkerStatus
  onBack(): void
  onConfigureWorker?(input: WorkerConfigureInput): Promise<void>
}
```

Change worker row call:

```tsx
<WorkerRow key={worker.id} worker={worker} onConfigureWorker={onConfigureWorker} />
```

Replace `WorkerRow` with a controlled form:

```tsx
function WorkerRow({ worker, onConfigureWorker }: { worker: WorkerRuntimeStatus; onConfigureWorker?: (input: WorkerConfigureInput) => Promise<void> }) {
  const [model, setModel] = useState(worker.model || workerModels[0].filename)
  const [maxVisits, setMaxVisits] = useState(String(worker.maxVisits || 500))
  const [saving, setSaving] = useState(false)
  const state = worker.available ? worker.busy ? 'busy' : 'available' : 'unavailable'
  const canSave = Boolean(onConfigureWorker && worker.available && !worker.busy && !saving)

  const save = async () => {
    if (!onConfigureWorker) return
    setSaving(true)
    try {
      await onConfigureWorker({ workerId: worker.id, model, maxVisits: Number(maxVisits) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <article className="worker-row" data-state={state}>
      <span className="worker-row-icon" aria-hidden="true">
        <Server size={18} />
      </span>
      <span className="worker-row-main">
        <strong>{worker.name || worker.id}</strong>
        <small>{worker.platform || 'unknown platform'} · {worker.backendLabel || worker.backend || 'unknown backend'}</small>
        {worker.error && <small className="worker-row-error">{worker.error}</small>}
        <span className="worker-controls">
          <label>
            模型
            <select value={model} onChange={(event) => setModel(event.target.value)} disabled={!canSave}>
              {workerModels.map((candidate) => (
                <option key={candidate.filename} value={candidate.filename}>{candidate.label}</option>
              ))}
            </select>
          </label>
          <label>
            Visits
            <input value={maxVisits} inputMode="numeric" onChange={(event) => setMaxVisits(event.target.value)} disabled={!canSave} />
          </label>
          <button type="button" onClick={() => void save()} disabled={!canSave}>保存</button>
        </span>
      </span>
      <span className="worker-row-state">{worker.available ? worker.busy ? '忙碌' : '可用' : '不可用'}</span>
    </article>
  )
}
```

- [ ] **Step 5: Wire App to worker.configure**

Modify `web/src/App.tsx` import:

```ts
import type { WorkerConfigureInput } from './api/types'
```

Add handler:

```ts
const configureWorker = async (input: WorkerConfigureInput) => {
  if (!client) return
  const status = await client.call('worker.configure', input)
  setWorkspace((current) => current ? { ...current, workerStatus: status as StatePayload['workerStatus'] } : current)
  await refreshWorkspaceState()
}
```

Pass prop:

```tsx
<SettingsPage workerStatus={workspace?.workerStatus} onBack={closeCurrentAppHistoryLayer} onConfigureWorker={configureWorker} />
```

- [ ] **Step 6: Add compact worker control CSS**

Modify `web/src/styles.css`:

```css
.worker-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 96px auto;
  gap: 8px;
  align-items: end;
  width: 100%;
}

.worker-controls label {
  display: grid;
  gap: 4px;
  color: var(--muted-text);
  font-size: 12px;
}

.worker-controls select,
.worker-controls input {
  min-width: 0;
  height: 32px;
  border: 1px solid var(--panel-border);
  border-radius: 6px;
  background: var(--panel-bg);
  color: var(--text);
}

.worker-controls button {
  height: 32px;
}
```

- [ ] **Step 7: Run frontend tests and commit**

Run:

```powershell
cd web
npm test -- --run src/components/SettingsPage.test.tsx
npm run build
```

Expected: PASS for tests and successful production build.

Commit:

```powershell
git add web/src/api/types.ts web/src/components/SettingsPage.tsx web/src/components/SettingsPage.test.tsx web/src/App.tsx web/src/styles.css
git commit -m "Add worker settings controls"
```

### Task 10: Full Verification And Deploy Smoke Test

**Files:**
- No planned source edits unless verification exposes a defect.

- [ ] **Step 1: Run backend tests**

Run:

```powershell
go test ./...
```

Expected: PASS.

- [ ] **Step 2: Run frontend tests and build**

Run:

```powershell
cd web
npm test -- --run
npm run build
```

Expected: PASS and Vite build success.

- [ ] **Step 3: Run deploy in no-pause mode**

Run from repository root:

```powershell
$env:JCGO_DEPLOY_NO_PAUSE='1'
.\deploy.bat
```

Expected: downloads missing manifest assets, stages all outputs, publishes to `~\.jcgo`, and exits with code 0. Existing `~\.jcgo\config.json` remains present and is not overwritten.

- [ ] **Step 4: Start runtime**

Run:

```powershell
$env:JCGO_RUNTIME_NO_PAUSE='1'
~\.jcgo\start.bat
```

Expected: `jcgo.exe` and `jcgo-worker.exe` start, and `~\.jcgo\log\worker.log` includes a registration path with backend/model/maxVisits.

- [ ] **Step 5: Manual UI smoke test**

Open:

```text
http://127.0.0.1:4380
```

Expected: Settings page shows one online Worker with backend, model, and visits. Changing model or visits and pressing 保存 updates the row after refresh. Starting analysis uses the selected visits count in the returned root visits after the next analysis result.

- [ ] **Step 6: Final commit for verification fixes**

If verification required fixes, commit them:

```powershell
git add -A
git commit -m "Fix deploy worker settings verification"
```

If no fixes were needed, do not create an empty commit.
