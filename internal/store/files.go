package store

import (
	"os"
	"path/filepath"
	"strings"
)

type FileStore struct {
	dir string
}

func NewFileStore(dir string) FileStore {
	return FileStore{dir: dir}
}

func (s FileStore) WriteSGF(gameID, sgfText string) (string, error) {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return "", err
	}
	path := s.path(cleanSGFName(gameID))
	if err := os.WriteFile(path, []byte(sgfText), 0o644); err != nil {
		return "", err
	}
	return path, nil
}

func (s FileStore) ReadSGF(filename string) (string, error) {
	data, err := os.ReadFile(s.path(cleanSGFName(filename)))
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (s FileStore) DeleteSGF(filename string) error {
	err := os.Remove(s.path(cleanSGFName(filename)))
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

func (s FileStore) WriteAnalysis(sgfFilename string, data []byte) (string, error) {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return "", err
	}
	path := s.path(analysisName(sgfFilename))
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return "", err
	}
	return path, nil
}

func (s FileStore) ReadAnalysis(sgfFilename string) ([]byte, error) {
	return os.ReadFile(s.path(analysisName(sgfFilename)))
}

func (s FileStore) AnalysisExists(filename string) bool {
	_, err := os.Stat(s.path(analysisName(filename)))
	return err == nil
}

func (s FileStore) DeleteAnalysis(sgfFilename string) error {
	err := os.Remove(s.path(analysisName(sgfFilename)))
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

func (s FileStore) path(filename string) string {
	return filepath.Join(s.dir, filename)
}

func cleanSGFName(name string) string {
	base := filepath.Base(name)
	ext := filepath.Ext(base)
	if !strings.EqualFold(ext, ".sgf") {
		base += ".sgf"
	}
	return base
}

func analysisName(sgfFilename string) string {
	base := cleanSGFName(sgfFilename)
	ext := filepath.Ext(base)
	return strings.TrimSuffix(base, ext) + ".analysis.json"
}
