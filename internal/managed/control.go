// Package managed implements WheelMaker's local managed-stdio contract.
package managed

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"time"
)

const MaxFrameSize = 8 << 10

type Component struct {
	ID      string `json:"id"`
	State   string `json:"state"`
	Message string `json:"message,omitempty"`
	PID     int    `json:"pid,omitempty"`
}

type Health struct {
	State      string      `json:"state"`
	Message    string      `json:"message,omitempty"`
	Components []Component `json:"components,omitempty"`
}

type Frame struct {
	Type       string  `json:"type"`
	RequestID  int64   `json:"requestId,omitempty"`
	Method     string  `json:"method,omitempty"`
	Protocol   int     `json:"protocol,omitempty"`
	AppID      string  `json:"appId"`
	InstanceID string  `json:"instanceId"`
	Version    string  `json:"version,omitempty"`
	Health     *Health `json:"health,omitempty"`
	Error      string  `json:"error,omitempty"`
}

type Options struct {
	Enabled bool
	Input   io.ReadCloser
	Output  io.Writer
	Health  func() Health
}

type Control struct {
	ctx         context.Context
	cancel      context.CancelFunc
	opts        Options
	initialized chan struct{}
	mu          sync.Mutex
	identity    Frame
	problem     error
	writes      chan write
	closeOnce   sync.Once
}

type write struct {
	data []byte
	done chan error
}

type RedactingWriter struct {
	Writer  io.Writer
	Secrets []string
}

func (w RedactingWriter) Write(data []byte) (int, error) {
	message := string(data)
	for _, secret := range w.Secrets {
		if secret != "" {
			message = strings.ReplaceAll(message, secret, "[redacted]")
		}
	}
	_, err := io.WriteString(w.Writer, message)
	return len(data), err
}

func Enabled() bool { return os.Getenv("WHEELMAKER_APP_MANAGED") == "1" }

func Start(ctx context.Context, opts Options) *Control {
	ctx, cancel := context.WithCancel(ctx)
	c := &Control{ctx: ctx, cancel: cancel, opts: opts, initialized: make(chan struct{}), writes: make(chan write, 8)}
	if opts.Enabled {
		go c.read()
		go c.writer()
	}
	return c
}

func (c *Control) Context() context.Context { return c.ctx }
func (c *Control) Err() error               { c.mu.Lock(); defer c.mu.Unlock(); return c.problem }
func (c *Control) Close() {
	c.closeOnce.Do(func() {
		c.cancel()
		if c.opts.Enabled {
			_ = c.opts.Input.Close()
		}
	})
}

func (c *Control) Ready(version string) error {
	if !c.opts.Enabled {
		return nil
	}
	select {
	case <-c.initialized:
	case <-c.ctx.Done():
		return c.ctx.Err()
	}
	health := c.opts.Health()
	return c.send(Frame{Type: "ready", Protocol: 1, Version: version, Health: &health})
}

func (c *Control) fail(err error) {
	c.mu.Lock()
	if c.problem == nil {
		c.problem = err
	}
	c.mu.Unlock()
	c.cancel()
}

func (c *Control) read() {
	scanner := bufio.NewScanner(c.opts.Input)
	scanner.Buffer(make([]byte, 1024), MaxFrameSize)
	initialized := false
	for scanner.Scan() {
		decoder := json.NewDecoder(bytes.NewReader(scanner.Bytes()))
		decoder.DisallowUnknownFields()
		var frame Frame
		if err := decoder.Decode(&frame); err != nil {
			c.fail(errors.New("invalid managed command"))
			return
		}
		var trailing any
		if decoder.Decode(&trailing) != io.EOF || frame.Type != "request" || frame.RequestID <= 0 {
			c.fail(errors.New("invalid managed request"))
			return
		}
		if !initialized {
			if frame.Method != "initialize" || frame.Protocol != 1 || frame.AppID == "" || len(frame.AppID) > 63 || frame.InstanceID == "" || len(frame.InstanceID) > 256 {
				c.fail(errors.New("invalid managed initialization"))
				return
			}
			c.mu.Lock()
			c.identity = frame
			c.mu.Unlock()
			initialized = true
			close(c.initialized)
			continue
		}
		c.mu.Lock()
		identity := c.identity
		c.mu.Unlock()
		if frame.AppID != identity.AppID || frame.InstanceID != identity.InstanceID {
			c.fail(errors.New("managed identity mismatch"))
			return
		}
		response := Frame{Type: "response", RequestID: frame.RequestID}
		switch frame.Method {
		case "health":
			health := c.opts.Health()
			response.Health = &health
		case "shutdown":
		default:
			response.Error = "unsupported managed method"
		}
		if err := c.send(response); err != nil {
			if c.ctx.Err() != nil {
				return
			}
			c.fail(err)
			return
		}
		if frame.Method == "shutdown" {
			c.cancel()
			return
		}
	}
	if err := scanner.Err(); err != nil && c.ctx.Err() == nil {
		c.fail(errors.New("managed command exceeds frame limit or cannot be read"))
		return
	}
	c.cancel()
}

func (c *Control) send(frame Frame) error {
	c.mu.Lock()
	frame.AppID = c.identity.AppID
	frame.InstanceID = c.identity.InstanceID
	c.mu.Unlock()
	data, err := json.Marshal(frame)
	if err != nil {
		return err
	}
	if len(data)+1 > MaxFrameSize {
		return errors.New("managed report exceeds frame limit")
	}
	ctx, cancel := context.WithTimeout(c.ctx, time.Second)
	defer cancel()
	call := write{data: append(data, '\n'), done: make(chan error, 1)}
	select {
	case c.writes <- call:
	case <-ctx.Done():
		return ctx.Err()
	}
	select {
	case err := <-call.done:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (c *Control) writer() {
	for {
		select {
		case <-c.ctx.Done():
			return
		case call := <-c.writes:
			_, err := c.opts.Output.Write(call.data)
			call.done <- err
		}
	}
}

// Redact removes application credentials before logs or managed health are emitted.
func Redact(message string, secrets ...string) string {
	for _, secret := range secrets {
		if secret != "" {
			message = strings.ReplaceAll(message, secret, "[redacted]")
		}
	}
	if len(message) > 1800 {
		message = message[:1800]
	}
	return strings.ToValidUTF8(message, "?")
}

func ErrorHealth(component, state string, err error, secrets ...string) Health {
	message := ""
	if err != nil {
		message = Redact(fmt.Sprint(err), secrets...)
	}
	return Health{State: "degraded", Components: []Component{{ID: component, State: state, Message: message}}}
}
