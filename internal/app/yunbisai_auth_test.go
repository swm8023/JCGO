package app

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

type yunbisaiAuthInvalidator interface {
	MarkInvalid(context.Context) error
}

func TestYunbisaiFileAuthStoreSavesLoadsAndClears(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "yunbisai_auth.json")
	store := NewYunbisaiFileAuthStore(path)

	if _, ok, err := store.Load(ctx); err != nil || ok {
		t.Fatalf("initial load = ok %v err %v", ok, err)
	}
	want := YunbisaiAuth{
		Token:     "token-1",
		LoginType: "3",
		Account:   YunbisaiAccount{LoginID: "7", Name: "棋手甲", Account: "138****0000"},
		Cookies:   []YunbisaiCookie{{Name: "token", Value: "token-1", Domain: ".yunbisai.com", Path: "/"}},
	}
	if err := store.Save(ctx, want); err != nil {
		t.Fatal(err)
	}
	got, ok, err := store.Load(ctx)
	if err != nil || !ok || got.Token != want.Token || got.Account.Name != want.Account.Name {
		t.Fatalf("load = %#v ok %v err %v", got, ok, err)
	}
	if got.UpdatedAt.IsZero() {
		t.Fatal("updatedAt should be set")
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil || info.Mode().Perm() != 0o600 {
			t.Fatalf("mode = %v err %v", info.Mode().Perm(), err)
		}
	}
	if err := store.Clear(ctx); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := store.Load(ctx); err != nil || ok {
		t.Fatalf("after clear = ok %v err %v", ok, err)
	}
}

func TestYunbisaiAuthStoresRejectIncompleteAuth(t *testing.T) {
	ctx := context.Background()
	stores := []YunbisaiAuthStore{
		NewYunbisaiFileAuthStore(filepath.Join(t.TempDir(), "auth.json")),
		NewYunbisaiMemoryAuthStore(),
	}
	for _, store := range stores {
		if err := store.Save(ctx, YunbisaiAuth{}); err == nil {
			t.Fatal("empty auth should be rejected")
		}
		if err := store.Save(ctx, YunbisaiAuth{Token: "token"}); err == nil {
			t.Fatal("auth without login id should be rejected")
		}
	}
}

func TestYunbisaiAuthStoresMarkInvalidWithoutDeleting(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "auth.json")
	stores := []struct {
		name  string
		store YunbisaiAuthStore
		path  string
	}{
		{name: "file", store: NewYunbisaiFileAuthStore(path), path: path},
		{name: "memory", store: NewYunbisaiMemoryAuthStore()},
	}

	for _, tc := range stores {
		t.Run(tc.name, func(t *testing.T) {
			want := yunbisaiTestAuth("7")
			if err := tc.store.Save(ctx, want); err != nil {
				t.Fatal(err)
			}
			invalidator, ok := tc.store.(yunbisaiAuthInvalidator)
			if !ok {
				t.Fatal("auth store should support marking an authorization invalid")
			}
			if err := invalidator.MarkInvalid(ctx); err != nil {
				t.Fatal(err)
			}
			got, available, err := tc.store.Load(ctx)
			if err != nil || available || got.Token != want.Token {
				t.Fatalf("invalid auth = %#v available %v err %v", got, available, err)
			}
			if tc.path == "" {
				return
			}
			if _, err := os.Stat(tc.path); err != nil {
				t.Fatalf("invalid auth file should remain: %v", err)
			}
			data, err := os.ReadFile(tc.path)
			if err != nil {
				t.Fatal(err)
			}
			var saved map[string]any
			if err := json.Unmarshal(data, &saved); err != nil {
				t.Fatal(err)
			}
			if saved["token"] != want.Token || saved["invalidatedAt"] == nil {
				t.Fatalf("saved invalid auth = %#v", saved)
			}
		})
	}
}

func TestYunbisaiAuthStoresSaveClearsInvalidMarker(t *testing.T) {
	ctx := context.Background()
	stores := []YunbisaiAuthStore{
		NewYunbisaiFileAuthStore(filepath.Join(t.TempDir(), "auth.json")),
		NewYunbisaiMemoryAuthStore(),
	}
	for _, store := range stores {
		if err := store.Save(ctx, yunbisaiTestAuth("7")); err != nil {
			t.Fatal(err)
		}
		invalidator, ok := store.(yunbisaiAuthInvalidator)
		if !ok {
			t.Fatal("auth store should support marking an authorization invalid")
		}
		if err := invalidator.MarkInvalid(ctx); err != nil {
			t.Fatal(err)
		}
		fresh := yunbisaiTestAuth("8")
		if err := store.Save(ctx, fresh); err != nil {
			t.Fatal(err)
		}
		got, available, err := store.Load(ctx)
		if err != nil || !available || got.Token != fresh.Token || got.Account.LoginID != fresh.Account.LoginID {
			t.Fatalf("fresh auth = %#v available %v err %v", got, available, err)
		}
	}
}

func TestYunbisaiMemoryAuthStore(t *testing.T) {
	ctx := context.Background()
	store := NewYunbisaiMemoryAuthStore()
	want := YunbisaiAuth{
		Token:   "token-2",
		Account: YunbisaiAccount{LoginID: "8", Name: "棋手乙"},
	}
	if err := store.Save(ctx, want); err != nil {
		t.Fatal(err)
	}
	got, ok, err := store.Load(ctx)
	if err != nil || !ok || got.Token != want.Token || got.Account.LoginID != want.Account.LoginID {
		t.Fatalf("load = %#v ok %v err %v", got, ok, err)
	}
	if err := store.Clear(ctx); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := store.Load(ctx); err != nil || ok {
		t.Fatalf("after clear = ok %v err %v", ok, err)
	}
}
