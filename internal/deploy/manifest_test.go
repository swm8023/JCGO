package deploy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadManifestSelectsPublishBackend(t *testing.T) {
	repo := t.TempDir()
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
	if err := os.WriteFile(filepath.Join(repo, "deploy-manifest.json"), raw, 0o644); err != nil {
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
	if err := os.WriteFile(filepath.Join(repo, "deploy-manifest.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := LoadManifest(Options{RepoRoot: repo})
	if err == nil || !strings.Contains(err.Error(), "publishBackend missing") {
		t.Fatalf("err = %v", err)
	}
}
