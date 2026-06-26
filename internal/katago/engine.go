package katago

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os/exec"
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
	mu     sync.Mutex
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout *bufio.Reader
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
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return &localEngine{cmd: cmd, stdin: stdin, stdout: bufio.NewReader(stdout)}, nil
}

func (e *localEngine) Analyze(ctx context.Context, query Query) (Result, error) {
	return e.AnalyzeWithProgress(ctx, query, nil)
}

func (e *localEngine) AnalyzeWithProgress(ctx context.Context, query Query, progress func(Result)) (Result, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	data, err := json.Marshal(query)
	if err != nil {
		return Result{}, err
	}
	if _, err := e.stdin.Write(append(data, '\n')); err != nil {
		return Result{}, err
	}
	for {
		if err := ctx.Err(); err != nil {
			return Result{}, err
		}
		line, err := e.stdout.ReadBytes('\n')
		if err != nil {
			return Result{}, err
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
	return true
}

func (e *localEngine) Status() Status {
	return Status{Available: true}
}

func (e *localEngine) Close() error {
	_ = e.stdin.Close()
	if e.cmd.Process != nil {
		_ = e.cmd.Process.Kill()
	}
	return e.cmd.Wait()
}
