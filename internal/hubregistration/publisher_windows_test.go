package hubregistration

import (
	"bufio"
	"context"
	"encoding/json"
	"github.com/tailscale/go-winio"
	"net"
	"strings"
	"testing"
	"time"
)

func TestRegistrationConflictRemainsDiagnosticAndCloseCancelsRetry(t *testing.T) {
	dir := t.TempDir()
	listener, err := winio.ListenPipe(Endpoint(dir), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	publisher := Publish(context.Background(), dir, "http://127.0.0.1:4380")
	conn, err := listener.Accept()
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	var request map[string]any
	if err := json.NewDecoder(conn).Decode(&request); err != nil {
		t.Fatal(err)
	}
	if err := json.NewEncoder(conn).Encode(response{Type: "response", RequestID: 1, Code: "conflict", Error: "application already registered"}); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for {
		state, err := publisher.Snapshot()
		if err != nil {
			if !strings.Contains(err.Error(), "conflict") || state.State != "pending" {
				t.Fatalf("state=%+v err=%v", state, err)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("conflict was not reported")
		}
		time.Sleep(time.Millisecond)
	}
	closed := make(chan struct{})
	go func() { publisher.Close(); close(closed) }()
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("close waited for retry timer")
	}
}

func TestPersistentPushReconnectConflictAndCancellation(t *testing.T) {
	dir := t.TempDir()
	listener, err := winio.ListenPipe(Endpoint(dir), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	target := "http://127.0.0.1:4380"
	publisher := Publish(context.Background(), dir, target)
	defer publisher.Close()
	accept := func() net.Conn {
		t.Helper()
		conn, err := listener.Accept()
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { conn.Close() })
		var open map[string]any
		if err := json.NewDecoder(conn).Decode(&open); err != nil {
			t.Fatal(err)
		}
		if open["operation"] != "open" || open["id"] != "jcgo" || open["target"] != target {
			t.Fatalf("open=%v", open)
		}
		return conn
	}
	push := func(conn net.Conn, kind string, version int64, state string) {
		t.Helper()
		err := json.NewEncoder(conn).Encode(response{Type: kind, RequestID: 1, Registration: Registration{ID: "jcgo", Target: target, Version: version, State: state, PublicURL: "https://example.test/jcgo/"}})
		if err != nil {
			t.Fatal(err)
		}
	}
	wait := func(state string, version int64) {
		t.Helper()
		deadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(deadline) {
			snapshot, _ := publisher.Snapshot()
			if snapshot.State == state && snapshot.Version == version {
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
		snapshot, err := publisher.Snapshot()
		t.Fatalf("snapshot=%+v err=%v", snapshot, err)
	}
	first := accept()
	push(first, "response", 1, "pending")
	push(first, "state", 3, "ready")
	push(first, "state", 2, "publishing")
	wait("ready", 3)
	first.Close()
	second := accept()
	push(second, "response", 1, "ready")
	wait("ready", 1)
	publisher.Close()
	_ = second.SetReadDeadline(time.Now().Add(time.Second))
	if _, err := bufio.NewReader(second).ReadByte(); err == nil {
		t.Fatal("publication did not release connection")
	}
}
