package app

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type YuanluoboAuth struct {
	Token     string    `json:"token"`
	UID       string    `json:"uid"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type YuanluoboAuthStore interface {
	Load(ctx context.Context) (YuanluoboAuth, bool, error)
	Save(ctx context.Context, auth YuanluoboAuth) error
	Clear(ctx context.Context) error
}

type YuanluoboFileAuthStore struct {
	path string
}

func NewYuanluoboFileAuthStore(path string) *YuanluoboFileAuthStore {
	return &YuanluoboFileAuthStore{path: path}
}

func (s *YuanluoboFileAuthStore) Load(context.Context) (YuanluoboAuth, bool, error) {
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return YuanluoboAuth{}, false, nil
	}
	if err != nil {
		return YuanluoboAuth{}, false, err
	}
	var auth YuanluoboAuth
	if err := json.Unmarshal(data, &auth); err != nil {
		return YuanluoboAuth{}, false, err
	}
	if auth.Token == "" || auth.UID == "" {
		return YuanluoboAuth{}, false, nil
	}
	return auth, true, nil
}

func (s *YuanluoboFileAuthStore) Save(_ context.Context, auth YuanluoboAuth) error {
	if auth.Token == "" || auth.UID == "" {
		return errors.New("yuanluobo auth token and uid are required")
	}
	auth.UpdatedAt = time.Now().UTC()
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(auth, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, data, 0o600)
}

func (s *YuanluoboFileAuthStore) Clear(context.Context) error {
	err := os.Remove(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

type YuanluoboMemoryAuthStore struct {
	mu   sync.Mutex
	auth YuanluoboAuth
	ok   bool
}

func NewYuanluoboMemoryAuthStore() *YuanluoboMemoryAuthStore {
	return &YuanluoboMemoryAuthStore{}
}

func (s *YuanluoboMemoryAuthStore) Load(context.Context) (YuanluoboAuth, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.auth, s.ok, nil
}

func (s *YuanluoboMemoryAuthStore) Save(_ context.Context, auth YuanluoboAuth) error {
	if auth.Token == "" || auth.UID == "" {
		return errors.New("yuanluobo auth token and uid are required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	auth.UpdatedAt = time.Now().UTC()
	s.auth = auth
	s.ok = true
	return nil
}

func (s *YuanluoboMemoryAuthStore) Clear(context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.auth = YuanluoboAuth{}
	s.ok = false
	return nil
}
