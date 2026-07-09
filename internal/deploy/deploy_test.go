package deploy

import (
	"archive/zip"
	"context"
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

func TestEnsureConfigFillsEmptyExistingWorkerModel(t *testing.T) {
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
	if !strings.Contains(string(raw), `"model": "a-model.bin.gz"`) {
		t.Fatalf("config = %s", raw)
	}
	if !strings.Contains(string(raw), `"token": "dev-token"`) {
		t.Fatalf("config lost existing fields: %s", raw)
	}
}

func TestCopyReleaseAssetsOverwritesRuntimeAssets(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "home")
	repo := filepath.Join(root, "repo")
	if err := os.MkdirAll(filepath.Join(repo, "release-assets", "model"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(repo, "release-assets", "bin", "KataGoData"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "release-assets", "katago.exe"), []byte("new-katago"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "release-assets", "bin", "OpenCL.dll"), []byte("runtime-dll"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "release-assets", "bin", "KataGoData", "tune.txt"), []byte("runtime-data"), 0o644); err != nil {
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
	assertFile(t, filepath.Join(state, "bin", "OpenCL.dll"), "runtime-dll")
	assertFile(t, filepath.Join(state, "bin", "KataGoData", "tune.txt"), "runtime-data")
	assertFile(t, filepath.Join(state, "config", "analysis_config.cfg"), "new-config")
	assertFile(t, filepath.Join(state, "model", "model.bin.gz"), "new-model")
}

func TestStageReleaseAssetsDownloadsAndPublishesSelectedBackend(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "home")
	repo := filepath.Join(root, "repo")
	if err := os.MkdirAll(filepath.Join(repo, "release-assets"), 0o755); err != nil {
		t.Fatal(err)
	}
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
	assertFile(t, filepath.Join(stage, "publish", "bin", "katago.exe"), "opencl-katago")
	assertFile(t, filepath.Join(stage, "publish", "bin", "OpenCL.dll"), "opencl-dll")
	assertFile(t, filepath.Join(stage, "publish", "bin", "KataGoData", "tune.txt"), "opencl-tune")
	assertFile(t, filepath.Join(stage, "publish", "model", DefaultWorkerModel), "b18-model")
	assertFile(t, filepath.Join(stage, "publish", "config", "katago_backend.json"), "{\n  \"id\": \"opencl\",\n  \"label\": \"OpenCL\"\n}\n")
	if _, err := os.Stat(filepath.Join(home, ".jcgo")); !os.IsNotExist(err) {
		t.Fatalf("runtime dir was touched: %v", err)
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
	for _, want := range []string{"Get-CimInstance Win32_Process", "jcgo.exe", "jcgo-worker.exe", "katago.exe", "ParentProcessId", "stop.bat.log", "Read-Host", "unmanaged process still running"} {
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
