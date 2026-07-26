package app

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

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
