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

type AutoDownloader struct{}
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
		downloader = AutoDownloader{}
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

func (AutoDownloader) Download(ctx context.Context, sourceURL string, dst string) error {
	parsed, err := url.Parse(sourceURL)
	if err != nil {
		return err
	}
	if parsed.Scheme == "file" || parsed.Scheme == "" {
		return FileDownloader{}.Download(ctx, sourceURL, dst)
	}
	return HTTPDownloader{}.Download(ctx, sourceURL, dst)
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
	_ = ctx
	src, err := fileURLPath(sourceURL)
	if err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	return writeStream(dst, in)
}

func fileURLPath(sourceURL string) (string, error) {
	parsed, err := url.Parse(sourceURL)
	if err != nil {
		return "", err
	}
	if parsed.Scheme == "" {
		return sourceURL, nil
	}
	if parsed.Scheme != "file" {
		return "", fmt.Errorf("unsupported file downloader scheme %q", parsed.Scheme)
	}
	src := parsed.Path
	if parsed.Host != "" {
		src = parsed.Host + parsed.Path
	}
	if strings.HasPrefix(src, "/") && len(src) >= 3 && src[2] == ':' {
		src = src[1:]
	}
	return filepath.FromSlash(src), nil
}

func writeStream(dst string, in io.Reader) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return fmt.Errorf("create destination dir: %w", err)
	}
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
	cleanDst := filepath.Clean(dst)
	for _, file := range reader.File {
		target := filepath.Join(cleanDst, filepath.Clean(file.Name))
		if target != cleanDst && !strings.HasPrefix(target, cleanDst+string(os.PathSeparator)) {
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
