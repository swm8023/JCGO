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
	PublishBackend string         `json:"publishBackend"`
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
