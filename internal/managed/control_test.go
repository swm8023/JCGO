package managed

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"strings"
	"testing"
	"time"
)

func TestManagedIdentityHealthShutdownAndEOF(t *testing.T) {
	for _, eof := range []bool{false, true} {
		t.Run(map[bool]string{false: "shutdown", true: "EOF"}[eof], func(t *testing.T) {
			input, commands := io.Pipe()
			reports, output := io.Pipe()
			defer reports.Close()
			defer output.Close()
			defer commands.Close()
			control := Start(context.Background(), Options{Enabled: true, Input: input, Output: output, Health: func() Health { return Health{State: "healthy"} }})
			defer control.Close()
			encoder := json.NewEncoder(commands)
			send := func(method string, id int64) {
				t.Helper()
				if err := encoder.Encode(Frame{Type: "request", RequestID: id, Method: method, Protocol: 1, AppID: "jcgo-server", InstanceID: "instance-123"}); err != nil {
					t.Fatal(err)
				}
			}
			send("initialize", 1)
			ready := make(chan error, 1)
			go func() { ready <- control.Ready("test") }()
			reader := bufio.NewReader(reports)
			read := func() Frame {
				t.Helper()
				line, err := reader.ReadBytes('\n')
				if err != nil {
					t.Fatal(err)
				}
				var frame Frame
				if err = json.Unmarshal(line, &frame); err != nil {
					t.Fatal(err)
				}
				if frame.AppID != "jcgo-server" || frame.InstanceID != "instance-123" {
					t.Fatalf("identity=%+v", frame)
				}
				return frame
			}
			if frame := read(); frame.Type != "ready" || frame.Protocol != 1 || frame.Health.State != "healthy" {
				t.Fatalf("ready=%+v", frame)
			}
			if err := <-ready; err != nil {
				t.Fatal(err)
			}
			go send("health", 2)
			if frame := read(); frame.RequestID != 2 || frame.Health.State != "healthy" {
				t.Fatalf("health=%+v", frame)
			}
			if eof {
				commands.Close()
			} else {
				go send("shutdown", 3)
				if frame := read(); frame.RequestID != 3 || frame.Type != "response" {
					t.Fatalf("shutdown=%+v", frame)
				}
			}
			select {
			case <-control.Context().Done():
			case <-time.After(time.Second):
				t.Fatal("stop did not cancel root")
			}
			if err := control.Err(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestManagedRejectsInvalidOrOversizedCommands(t *testing.T) {
	for _, data := range []string{`{"type":"request","requestId":1,"method":"initialize","protocol":2,"appId":"jcgo","instanceId":"x"}` + "\n", strings.Repeat("x", MaxFrameSize) + "\n"} {
		control := Start(context.Background(), Options{Enabled: true, Input: io.NopCloser(strings.NewReader(data)), Output: io.Discard, Health: func() Health { return Health{State: "unknown"} }})
		select {
		case <-control.Context().Done():
		case <-time.After(time.Second):
			t.Fatal("invalid input left alive")
		}
		if control.Err() == nil {
			t.Fatal("invalid input accepted")
		}
		control.Close()
	}
}

func TestRoleLocksAndLiveManagedMaintenanceGuard(t *testing.T) {
	dir := t.TempDir()
	server, err := Acquire(dir, "server", true)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	if duplicate, err := Acquire(dir, "server", false); err == nil {
		duplicate.Close()
		t.Fatal("second root accepted")
	}
	worker, err := Acquire(dir, "worker", false)
	if err != nil {
		t.Fatal(err)
	}
	defer worker.Close()
	if err := CheckMaintenance(dir); err == nil || !strings.Contains(err.Error(), "Hub Monitor") {
		t.Fatalf("maintenance=%v", err)
	}
	server.Close()
	if err := CheckMaintenance(dir); err != nil {
		t.Fatalf("stale ownership blocked maintenance: %v", err)
	}
	restarted, err := Acquire(dir, "server", false)
	if err != nil {
		t.Fatal(err)
	}
	restarted.Close()
}

func TestCredentialRedactionIsBounded(t *testing.T) {
	got := Redact(strings.Repeat("secret-credential ", 1000), "secret-credential")
	if strings.Contains(got, "secret-credential") || len(got) > 1800 {
		t.Fatal("unbounded credential report")
	}
}
