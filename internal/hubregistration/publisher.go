// Package hubregistration publishes JCGO using WheelMaker's existing local IPC protocol.
package hubregistration

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

const maxFrameSize = 8 << 10

type Registration struct {
	Version   int64  `json:"version"`
	ID        string `json:"id"`
	Target    string `json:"target"`
	State     string `json:"state"`
	PublicURL string `json:"publicUrl,omitempty"`
	Error     string `json:"error,omitempty"`
}

type response struct {
	Type         string       `json:"type"`
	RequestID    int64        `json:"requestId"`
	Registration Registration `json:"registration"`
	Code         string       `json:"code"`
	Error        string       `json:"error"`
}

type Publisher struct {
	mu           sync.RWMutex
	registration Registration
	err          error
	cancel       context.CancelFunc
	done         chan struct{}
}

func Endpoint(dir string) string {
	if runtime.GOOS != "windows" {
		return filepath.Join(dir, "private", "app-registration.sock")
	}
	abs, _ := filepath.Abs(dir)
	hash := sha256.Sum256([]byte(strings.ToLower(filepath.Clean(abs))))
	return `\\.\pipe\wheelmaker-app-registration-` + hex.EncodeToString(hash[:12])
}

func Publish(ctx context.Context, dir, target string) *Publisher {
	ctx, cancel := context.WithCancel(ctx)
	p := &Publisher{registration: Registration{ID: "jcgo", Target: target, State: "pending"}, cancel: cancel, done: make(chan struct{})}
	go p.run(ctx, dir, target)
	return p
}

func (p *Publisher) Snapshot() (Registration, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.registration, p.err
}
func (p *Publisher) Close() { p.cancel(); <-p.done }

func (p *Publisher) run(ctx context.Context, dir, target string) {
	defer close(p.done)
	failures := 0
	for ctx.Err() == nil {
		err := p.session(ctx, dir, target, func() { failures = 0 })
		if ctx.Err() != nil {
			return
		}
		p.mu.Lock()
		p.err = err
		p.registration.State = "pending"
		p.registration.PublicURL = ""
		p.registration.Version = 0
		p.mu.Unlock()
		timer := time.NewTimer(time.Second * time.Duration(1<<min(failures, 5)))
		failures++
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

func (p *Publisher) session(ctx context.Context, dir, target string, connected func()) error {
	dialCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	conn, err := dial(dialCtx, Endpoint(dir))
	cancel()
	if err != nil {
		return fmt.Errorf("Hub registration unavailable: %w", err)
	}
	defer conn.Close()
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	request := map[string]any{"operation": "open", "requestId": 1, "id": "jcgo", "target": target}
	if err := json.NewEncoder(conn).Encode(request); err != nil {
		return err
	}
	reader := bufio.NewReaderSize(conn, maxFrameSize+1)
	first := true
	for {
		line, err := reader.ReadSlice('\n')
		if err != nil {
			return err
		}
		if len(line) > maxFrameSize {
			return errors.New("Hub registration frame is too large")
		}
		decoder := json.NewDecoder(bytes.NewReader(line))
		var frame response
		if err := decoder.Decode(&frame); err != nil {
			return errors.New("invalid Hub registration frame")
		}
		var trailing any
		if decoder.Decode(&trailing) != io.EOF {
			return errors.New("invalid Hub registration frame")
		}
		if frame.Code != "" {
			return fmt.Errorf("Hub registration %s: %s", frame.Code, frame.Error)
		}
		if frame.Registration.ID != "jcgo" || frame.Registration.Target != target || frame.Registration.Version < 1 {
			return errors.New("Hub registration identity mismatch")
		}
		if first {
			if frame.Type != "response" || frame.RequestID != 1 {
				return errors.New("invalid Hub registration response")
			}
			_ = conn.SetDeadline(time.Time{})
			connected()
			first = false
		} else if frame.Type != "state" {
			return errors.New("invalid Hub registration notification")
		}
		p.mu.Lock()
		if frame.Registration.Version >= p.registration.Version {
			p.registration = frame.Registration
			p.err = nil
		}
		p.mu.Unlock()
	}
}
