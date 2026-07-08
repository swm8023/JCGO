package app

import (
	"context"
	"path/filepath"
	"testing"
)

func TestYuanluoboFileAuthStoreSavesLoadsAndClears(t *testing.T) {
	ctx := context.Background()
	store := NewYuanluoboFileAuthStore(filepath.Join(t.TempDir(), "yuanluobo_auth.json"))

	if _, ok, err := store.Load(ctx); err != nil || ok {
		t.Fatalf("initial load auth = ok %v err %v", ok, err)
	}

	auth := YuanluoboAuth{Token: "token-1", UID: "uid-1"}
	if err := store.Save(ctx, auth); err != nil {
		t.Fatal(err)
	}
	loaded, ok, err := store.Load(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !ok || loaded.Token != "token-1" || loaded.UID != "uid-1" || loaded.UpdatedAt.IsZero() {
		t.Fatalf("loaded = %#v ok = %v", loaded, ok)
	}

	if err := store.Clear(ctx); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := store.Load(ctx); err != nil || ok {
		t.Fatalf("after clear auth = ok %v err %v", ok, err)
	}
}

func TestYuanluoboMemoryAuthStore(t *testing.T) {
	ctx := context.Background()
	store := NewYuanluoboMemoryAuthStore()
	if err := store.Save(ctx, YuanluoboAuth{Token: "token-2", UID: "uid-2"}); err != nil {
		t.Fatal(err)
	}
	loaded, ok, err := store.Load(ctx)
	if err != nil || !ok {
		t.Fatalf("loaded = %#v ok = %v err = %v", loaded, ok, err)
	}
	if loaded.Token != "token-2" || loaded.UID != "uid-2" {
		t.Fatalf("loaded = %#v", loaded)
	}
}
