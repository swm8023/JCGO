package worker

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/gorilla/websocket"

	"jcgo/internal/katago"
)

type ClientRuntime interface {
	Info() Info
	Analyze(context.Context, katago.Query, RuntimeConfig) (katago.Result, error)
}

type ClientProgressRuntime interface {
	AnalyzeWithProgress(context.Context, katago.Query, RuntimeConfig, func(katago.Result)) (katago.Result, error)
}

func ServeConnection(ctx context.Context, serverURL string, accessToken string, runtime ClientRuntime) error {
	dialer := websocket.Dialer{Subprotocols: []string{Subprotocol, "token." + accessToken}}
	conn, _, err := dialer.DialContext(ctx, serverURL, nil)
	if err != nil {
		return err
	}
	defer conn.Close()
	ctxDone := make(chan struct{})
	defer close(ctxDone)
	go func() {
		select {
		case <-ctx.Done():
			_ = conn.Close()
		case <-ctxDone:
		}
	}()

	var writeMu sync.Mutex
	writeEnvelope := func(env Envelope) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.WriteJSON(env)
	}

	var jobsMu sync.Mutex
	jobs := map[string]context.CancelFunc{}
	cancelJob := func(id string) {
		jobsMu.Lock()
		cancel := jobs[id]
		jobsMu.Unlock()
		if cancel != nil {
			cancel()
		}
	}
	removeJob := func(id string) {
		jobsMu.Lock()
		delete(jobs, id)
		jobsMu.Unlock()
	}
	defer func() {
		jobsMu.Lock()
		cancels := make([]context.CancelFunc, 0, len(jobs))
		for _, cancel := range jobs {
			cancels = append(cancels, cancel)
		}
		jobs = map[string]context.CancelFunc{}
		jobsMu.Unlock()
		for _, cancel := range cancels {
			cancel()
		}
	}()

	info := runtime.Info()
	if err := writeEnvelope(Envelope{Type: MessageRegister, Worker: &info}); err != nil {
		return err
	}

	for {
		var msg Envelope
		if err := conn.ReadJSON(&msg); err != nil {
			return err
		}
		switch msg.Type {
		case MessageAnalyze:
			if msg.Query == nil {
				_ = writeEnvelope(Envelope{Type: MessageError, ID: msg.ID, Error: "analyze query is required"})
				continue
			}
			if msg.Config == nil {
				_ = writeEnvelope(Envelope{Type: MessageError, ID: msg.ID, Error: "analyze config is required"})
				continue
			}
			jobCtx, cancel := context.WithCancel(ctx)
			jobsMu.Lock()
			if previous := jobs[msg.ID]; previous != nil {
				previous()
			}
			jobs[msg.ID] = cancel
			jobsMu.Unlock()
			go func(msg Envelope, jobCtx context.Context) {
				defer removeJob(msg.ID)
				_ = analyzeAndReply(jobCtx, writeEnvelope, msg.ID, *msg.Query, *msg.Config, runtime)
			}(msg, jobCtx)
		case MessageCancel:
			cancelJob(msg.ID)
		default:
			_ = writeEnvelope(Envelope{Type: MessageError, ID: msg.ID, Error: fmt.Sprintf("unexpected message %q", msg.Type)})
		}
	}
}

func analyzeAndReply(ctx context.Context, writeEnvelope func(Envelope) error, id string, query katago.Query, cfg RuntimeConfig, runtime ClientRuntime) error {
	writeResult := func(result katago.Result) {
		_ = writeEnvelope(Envelope{Type: MessageResult, ID: id, Result: &result})
	}

	var (
		result katago.Result
		err    error
	)
	if progressEngine, ok := runtime.(ClientProgressRuntime); ok {
		result, err = progressEngine.AnalyzeWithProgress(ctx, query, cfg, writeResult)
	} else {
		result, err = runtime.Analyze(ctx, query, cfg)
	}
	if err != nil {
		if writeErr := writeEnvelope(Envelope{Type: MessageError, ID: id, Error: err.Error()}); writeErr != nil {
			return errors.Join(err, writeErr)
		}
		return nil
	}
	return writeEnvelope(Envelope{Type: MessageResult, ID: id, Result: &result})
}
