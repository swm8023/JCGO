package katago

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
)

type Result struct {
	ID             string     `json:"id"`
	RootInfo       RootInfo   `json:"rootInfo"`
	MoveInfos      []MoveInfo `json:"moveInfos"`
	Ownership      []float64  `json:"ownership,omitempty"`
	Policy         []float64  `json:"policy,omitempty"`
	IsDuringSearch bool       `json:"isDuringSearch,omitempty"`
	Error          string     `json:"error,omitempty"`
}

type RootInfo struct {
	Visits    int     `json:"visits"`
	Winrate   float64 `json:"winrate"`
	ScoreLead float64 `json:"scoreLead"`
}

type MoveInfo struct {
	Move      string   `json:"move"`
	Visits    int      `json:"visits"`
	Winrate   float64  `json:"winrate"`
	ScoreLead float64  `json:"scoreLead"`
	Order     int      `json:"order"`
	PV        []string `json:"pv"`
}

type Analyzer interface {
	Analyze(context.Context, Query) (Result, error)
	Available() bool
	Status() Status
	Close() error
}

type ProgressAnalyzer interface {
	AnalyzeWithProgress(context.Context, Query, func(Result)) (Result, error)
}

type Status struct {
	Available bool   `json:"available"`
	Error     string `json:"error,omitempty"`
}

func NewUnavailable(message string) Analyzer {
	return unavailable{message: message}
}

type unavailable struct {
	message string
}

func (u unavailable) Analyze(context.Context, Query) (Result, error) {
	return Result{}, errors.New(u.message)
}

func (u unavailable) Available() bool {
	return false
}

func (u unavailable) Status() Status {
	return Status{Available: false, Error: u.message}
}

func (u unavailable) Close() error {
	return nil
}

type localEngine struct {
	mu       sync.Mutex
	cmd      *exec.Cmd
	stdin    io.WriteCloser
	stdout   *bufio.Reader
	stderr   *lockedBuffer
	waitDone chan struct{}
	waitErr  error
}

func StartLocal(ctx context.Context, katagoPath, modelPath, configPath string) (Analyzer, error) {
	cmd := exec.CommandContext(ctx, katagoPath, "analysis", "-model", modelPath, "-config", configPath)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}
	stderr := &lockedBuffer{}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	stderrDone := make(chan struct{})
	go func() {
		_, _ = io.Copy(stderr, stderrPipe)
		close(stderrDone)
	}()
	engine := &localEngine{
		cmd:      cmd,
		stdin:    stdin,
		stdout:   bufio.NewReader(stdout),
		stderr:   stderr,
		waitDone: make(chan struct{}),
	}
	go func() {
		<-stderrDone
		engine.waitErr = cmd.Wait()
		close(engine.waitDone)
	}()
	return engine, nil
}

func (e *localEngine) Analyze(ctx context.Context, query Query) (Result, error) {
	return e.AnalyzeWithProgress(ctx, query, nil)
}

func (e *localEngine) AnalyzeWithProgress(ctx context.Context, query Query, progress func(Result)) (Result, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	stopCancel := context.AfterFunc(ctx, func() {
		e.interrupt()
	})
	defer stopCancel()

	data, err := json.Marshal(query)
	if err != nil {
		return Result{}, err
	}
	if _, err := e.stdin.Write(append(data, '\n')); err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return Result{}, ctxErr
		}
		return Result{}, e.withProcessExit(err)
	}
	for {
		if err := ctx.Err(); err != nil {
			return Result{}, err
		}
		line, err := e.stdout.ReadBytes('\n')
		if err != nil {
			if ctxErr := ctx.Err(); ctxErr != nil {
				return Result{}, ctxErr
			}
			return Result{}, e.withProcessExit(err)
		}
		var result Result
		if err := json.Unmarshal(line, &result); err != nil {
			return Result{}, err
		}
		if result.Error != "" {
			return Result{}, errors.New(result.Error)
		}
		if result.IsDuringSearch {
			if progress != nil {
				progress(result)
			}
			continue
		}
		return result, nil
	}
}

func (e *localEngine) Available() bool {
	_, exited := e.exitStatus()
	return !exited
}

func (e *localEngine) Status() Status {
	if err, exited := e.exitStatus(); exited {
		return Status{Available: false, Error: e.exitMessage(err)}
	}
	return Status{Available: true}
}

func (e *localEngine) Close() error {
	e.interrupt()
	<-e.waitDone
	return e.waitErr
}

func (e *localEngine) interrupt() {
	_ = e.stdin.Close()
	if e.cmd.Process != nil {
		_ = e.cmd.Process.Kill()
	}
}

func (e *localEngine) exitStatus() (error, bool) {
	select {
	case <-e.waitDone:
		return e.waitErr, true
	default:
		return nil, false
	}
}

func (e *localEngine) withProcessExit(err error) error {
	if waitErr, exited := e.exitStatus(); exited {
		return errors.New(e.exitMessage(firstError(waitErr, err)))
	}
	return err
}

func (e *localEngine) exitMessage(err error) string {
	stderr := strings.TrimSpace(e.stderr.String())
	if stderr != "" {
		if err != nil {
			return fmt.Sprintf("katago exited: %s: %v", stderr, err)
		}
		return fmt.Sprintf("katago exited: %s", stderr)
	}
	if err != nil {
		return fmt.Sprintf("katago exited: %v", err)
	}
	return "katago exited"
}

func firstError(primary error, fallback error) error {
	if primary != nil {
		return primary
	}
	return fallback
}

type lockedBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}
