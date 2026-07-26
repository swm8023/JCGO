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

type YunbisaiCookie struct {
	Name    string `json:"name"`
	Value   string `json:"value"`
	Domain  string `json:"domain"`
	Path    string `json:"path"`
	Expires int64  `json:"expires,omitempty"`
}

type YunbisaiAccount struct {
	LoginID   string `json:"loginId"`
	Name      string `json:"name"`
	Account   string `json:"account"`
	ImageURL  string `json:"imageUrl,omitempty"`
	LoginType string `json:"-"`
}

type YunbisaiAuth struct {
	Token     string           `json:"token"`
	LoginType string           `json:"loginType"`
	Account   YunbisaiAccount  `json:"account"`
	Cookies   []YunbisaiCookie `json:"cookies"`
	UpdatedAt time.Time        `json:"updatedAt"`
}

type YunbisaiAuthStore interface {
	Load(context.Context) (YunbisaiAuth, bool, error)
	Save(context.Context, YunbisaiAuth) error
	Clear(context.Context) error
}

type YunbisaiFileAuthStore struct {
	path string
}

func NewYunbisaiFileAuthStore(path string) *YunbisaiFileAuthStore {
	return &YunbisaiFileAuthStore{path: path}
}

func (s *YunbisaiFileAuthStore) Load(context.Context) (YunbisaiAuth, bool, error) {
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return YunbisaiAuth{}, false, nil
	}
	if err != nil {
		return YunbisaiAuth{}, false, err
	}
	var auth YunbisaiAuth
	if err := json.Unmarshal(data, &auth); err != nil {
		return YunbisaiAuth{}, false, err
	}
	if !validYunbisaiAuth(auth) {
		return YunbisaiAuth{}, false, nil
	}
	return auth, true, nil
}

func (s *YunbisaiFileAuthStore) Save(_ context.Context, auth YunbisaiAuth) error {
	if !validYunbisaiAuth(auth) {
		return errors.New("yunbisai auth token and login id are required")
	}
	auth.UpdatedAt = time.Now().UTC()
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(auth, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, append(data, '\n'), 0o600)
}

func (s *YunbisaiFileAuthStore) Clear(context.Context) error {
	err := os.Remove(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

type YunbisaiMemoryAuthStore struct {
	mu   sync.Mutex
	auth YunbisaiAuth
	ok   bool
}

func NewYunbisaiMemoryAuthStore() *YunbisaiMemoryAuthStore {
	return &YunbisaiMemoryAuthStore{}
}

func (s *YunbisaiMemoryAuthStore) Load(context.Context) (YunbisaiAuth, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.auth, s.ok, nil
}

func (s *YunbisaiMemoryAuthStore) Save(_ context.Context, auth YunbisaiAuth) error {
	if !validYunbisaiAuth(auth) {
		return errors.New("yunbisai auth token and login id are required")
	}
	auth.UpdatedAt = time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.auth = auth
	s.ok = true
	return nil
}

func (s *YunbisaiMemoryAuthStore) Clear(context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.auth = YunbisaiAuth{}
	s.ok = false
	return nil
}

func validYunbisaiAuth(auth YunbisaiAuth) bool {
	return auth.Token != "" && auth.Account.LoginID != ""
}
