package deploy

import (
	"archive/zip"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnsureConfigCreatesConnectionOnlyDefaultConfig(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "home")
	repo := filepath.Join(root, "repo")

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
	text := string(raw)
	for _, want := range []string{`"server"`, `"worker"`, `"url": "ws://127.0.0.1:4380/worker"`, `"token": "dev-token"`} {
		if !strings.Contains(text, want) {
			t.Fatalf("config missing %q: %s", want, raw)
		}
	}
	if strings.Contains(text, `"model"`) || strings.Contains(text, `"maxVisits"`) {
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

func TestEnsureConfigPreservesExistingConfigWithEmptyWorkerModel(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "home")
	repo := filepath.Join(root, "repo")
	state := filepath.Join(home, ".jcgo")
	if err := os.MkdirAll(state, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(state, "config.json")
	existing := []byte(`{
  "server": {"enabled": true, "port": 4380, "token": "dev-token"},
  "worker": {"enabled": true, "name": "local-gpu", "url": "ws://127.0.0.1:4380/worker", "token": "dev-token", "model": "", "maxVisits": 500},
  "log": {"level": "warn"}
}`)
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

func TestStageReleaseAssetsDownloadsAndPublishesSelectedBackend(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "home")
	repo := filepath.Join(root, "repo")
	openclZip := filepath.Join(root, "opencl.zip")
	cudaZip := filepath.Join(root, "cuda.zip")
	writeZip(t, openclZip, map[string]string{
		"katago.exe":          "opencl-katago",
		"OpenCL.dll":          "opencl-dll",
		"KataGoData/tune.txt": "opencl-tune",
	})
	writeZip(t, cudaZip, map[string]string{
		"katago.exe":    "cuda-katago",
		"cudnn64_9.dll": "cuda-dll",
	})
	modelPath := filepath.Join(root, "b18.bin.gz")
	if err := os.WriteFile(modelPath, []byte("b18-model"), 0o644); err != nil {
		t.Fatal(err)
	}
	manifest := Manifest{
		Katago: KatagoManifest{
			Version:        "v1.16.5",
			PublishBackend: "opencl",
			Backends: []BackendAsset{
				{ID: "opencl", Label: "OpenCL", Archive: "opencl.zip", URL: "file://" + filepath.ToSlash(openclZip)},
				{ID: "cuda12.8", Label: "CUDA", Archive: "cuda.zip", URL: "file://" + filepath.ToSlash(cudaZip)},
			},
		},
		Models: []ModelAsset{{ID: "b18", Filename: DefaultWorkerModel, URL: "file://" + filepath.ToSlash(modelPath)}},
	}

	if err := StageReleaseAssets(context.Background(), Options{RepoRoot: repo, HomeDir: home}, manifest, FileDownloader{}); err != nil {
		t.Fatalf("StageReleaseAssets returned error: %v", err)
	}

	stage := StageDir(Options{RepoRoot: repo, HomeDir: home})
	assertFile(t, filepath.Join(stage, "bin", "katago.exe"), "opencl-katago")
	assertFile(t, filepath.Join(stage, "bin", "OpenCL.dll"), "opencl-dll")
	assertFile(t, filepath.Join(stage, "bin", "KataGoData", "tune.txt"), "opencl-tune")
	assertFile(t, filepath.Join(stage, "model", DefaultWorkerModel), "b18-model")
	assertFile(t, filepath.Join(stage, "config", "katago_backend.json"), "{\n  \"id\": \"opencl\",\n  \"label\": \"OpenCL\"\n}\n")
	assertExists(t, filepath.Join(stage, ".download", "katago", "opencl.zip"))
	assertFile(t, filepath.Join(stage, ".download", "model", DefaultWorkerModel), "b18-model")
	if _, err := os.Stat(filepath.Join(stage, "katago")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("backend staging dir exists: %v", err)
	}
	if _, err := os.Stat(filepath.Join(stage, "publish")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("nested publish dir exists: %v", err)
	}
	if _, err := os.Stat(filepath.Join(home, ".jcgo")); !os.IsNotExist(err) {
		t.Fatalf("runtime dir was touched: %v", err)
	}
}

func TestStageReleaseAssetsReusesInstalledModelBeforeDownloading(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "home")
	repo := filepath.Join(root, "repo")
	cache := filepath.Join(repo, ".stage", ".download", "katago")
	if err := os.MkdirAll(cache, 0o755); err != nil {
		t.Fatal(err)
	}
	writeZip(t, filepath.Join(cache, "opencl.zip"), map[string]string{"katago.exe": "opencl-katago"})
	installedModel := filepath.Join(home, ".jcgo", "model", DefaultWorkerModel)
	if err := os.MkdirAll(filepath.Dir(installedModel), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(installedModel, []byte("installed-model"), 0o644); err != nil {
		t.Fatal(err)
	}
	manifest := Manifest{
		Katago: KatagoManifest{
			Version:        "v1.16.5",
			PublishBackend: "opencl",
			Backends:       []BackendAsset{{ID: "opencl", Label: "OpenCL", Archive: "opencl.zip", URL: "https://example.test/opencl.zip"}},
		},
		Models: []ModelAsset{{ID: "b18", Filename: DefaultWorkerModel, URL: "https://example.test/b18.bin.gz"}},
	}

	if err := StageReleaseAssets(context.Background(), Options{RepoRoot: repo, HomeDir: home}, manifest, failingDownloader{}); err != nil {
		t.Fatalf("StageReleaseAssets returned error: %v", err)
	}

	stage := StageDir(Options{RepoRoot: repo, HomeDir: home})
	assertFile(t, filepath.Join(stage, "model", DefaultWorkerModel), "installed-model")
	assertFile(t, filepath.Join(stage, ".download", "model", DefaultWorkerModel), "installed-model")
}

func TestAutoDownloaderUsesAria2ForHTTPDownloads(t *testing.T) {
	oldLookPath := execLookPath
	oldRunCommand := runDownloadCommand
	defer func() {
		execLookPath = oldLookPath
		runDownloadCommand = oldRunCommand
	}()

	execLookPath = func(name string) (string, error) {
		if name != "aria2c" {
			return "", errors.New("unexpected command")
		}
		return "fake-aria2c", nil
	}
	var gotName string
	var gotArgs []string
	runDownloadCommand = func(ctx context.Context, name string, args ...string) error {
		gotName = name
		gotArgs = append([]string{}, args...)
		dir := commandArgValue(t, args, "--dir")
		out := commandArgValue(t, args, "--out")
		if err := os.WriteFile(filepath.Join(dir, out), []byte("downloaded"), 0o644); err != nil {
			return err
		}
		return nil
	}

	dst := filepath.Join(t.TempDir(), "model.bin.gz")
	if err := (AutoDownloader{}).Download(context.Background(), "https://example.test/model.bin.gz", dst); err != nil {
		t.Fatalf("Download returned error: %v", err)
	}

	if gotName != "fake-aria2c" {
		t.Fatalf("download command = %q", gotName)
	}
	if !hasArg(gotArgs, "-x") || !hasArg(gotArgs, "--continue=true") {
		t.Fatalf("aria2 args = %#v", gotArgs)
	}
	assertFile(t, dst, "downloaded")
	if _, err := os.Stat(dst + ".tmp"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("temporary file still exists: %v", err)
	}
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
	for _, name := range []string{"bin", "model", "config", "web"} {
		if _, err := os.Stat(filepath.Join(repo, ".stage", name)); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("stage target %s was not cleaned: %v", name, err)
		}
	}
	assertFile(t, filepath.Join(repo, ".stage", ".download", "model", DefaultWorkerModel), "b18-model")
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
	for _, want := range []string{"jcgo.exe", "jcgo-worker.exe", "--dir", "start.bat.log", "Read-Host"} {
		if !strings.Contains(string(start), want) {
			t.Fatalf("start.bat missing %q:\n%s", want, start)
		}
	}
	for _, want := range []string{"Get-CimInstance Win32_Process", "jcgo.exe", "jcgo-worker.exe", "katago.exe", "stop.bat.log", "Read-Host", "unmanaged process still running"} {
		if !strings.Contains(string(stop), want) {
			t.Fatalf("stop.bat missing %q:\n%s", want, stop)
		}
	}
}

func TestStopScriptDoesNotIncludeDescendantsOfManagedProcesses(t *testing.T) {
	home := filepath.Join(t.TempDir(), "home")
	if err := WriteScripts(Options{HomeDir: home}); err != nil {
		t.Fatal(err)
	}
	stop, err := os.ReadFile(filepath.Join(home, ".jcgo", "stop.bat"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(stop), "ParentProcessId") {
		t.Fatalf("stop.bat must target only managed runtime executables, not their arbitrary descendants:\n%s", stop)
	}
}

func TestStopExistingRuntimeRefreshesStopScriptBeforeRunningIt(t *testing.T) {
	home := filepath.Join(t.TempDir(), "home")
	state := filepath.Join(home, ".jcgo")
	if err := os.MkdirAll(state, 0o755); err != nil {
		t.Fatal(err)
	}
	stopPath := filepath.Join(state, "stop.bat")
	if err := os.WriteFile(stopPath, []byte("ParentProcessId"), 0o644); err != nil {
		t.Fatal(err)
	}
	runner := runnerFunc(func(ctx context.Context, dir string, name string, args ...string) error {
		raw, err := os.ReadFile(name)
		if err != nil {
			return err
		}
		if strings.Contains(string(raw), "ParentProcessId") {
			t.Fatalf("stale stop script was run:\n%s", raw)
		}
		return nil
	})

	if err := stopExistingRuntime(context.Background(), Options{HomeDir: home}, runner); err != nil {
		t.Fatalf("stopExistingRuntime returned error: %v", err)
	}
}

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

func assertExists(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}
}

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

type recordingRunner struct {
	failOn string
	calls  []string
}

type runnerFunc func(ctx context.Context, dir string, name string, args ...string) error

func (f runnerFunc) Run(ctx context.Context, dir string, name string, args ...string) error {
	return f(ctx, dir, name, args...)
}

func (r *recordingRunner) Run(ctx context.Context, dir string, name string, args ...string) error {
	call := name + " " + strings.Join(args, " ")
	r.calls = append(r.calls, call)
	if r.failOn != "" && strings.Contains(call, r.failOn) {
		return errors.New("forced failure")
	}
	return nil
}

type failingDownloader struct{}

func (failingDownloader) Download(ctx context.Context, sourceURL string, dst string) error {
	return errors.New("download should not be called")
}

func writeMinimalManifestAndStageFiles(t *testing.T, repo string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(repo, ".stage", ".download", "katago"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(repo, ".stage", ".download", "model"), 0o755); err != nil {
		t.Fatal(err)
	}
	openclZip := filepath.Join(repo, ".stage", ".download", "katago", "opencl.zip")
	writeZip(t, openclZip, map[string]string{"katago.exe": "opencl-katago"})
	modelPath := filepath.Join(repo, ".stage", ".download", "model", DefaultWorkerModel)
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
	if err := os.WriteFile(filepath.Join(repo, "deploy-manifest.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(repo, "web", "dist"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "web", "dist", "index.html"), []byte("web"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func commandArgValue(t *testing.T, args []string, name string) string {
	t.Helper()
	for i := 0; i < len(args)-1; i++ {
		if args[i] == name {
			return args[i+1]
		}
	}
	t.Fatalf("missing command arg %s in %#v", name, args)
	return ""
}

func hasArg(args []string, want string) bool {
	for _, arg := range args {
		if arg == want {
			return true
		}
	}
	return false
}
