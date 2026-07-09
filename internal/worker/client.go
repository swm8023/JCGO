package worker

import (
	"context"
	"errors"
	"fmt"

	"github.com/gorilla/websocket"

	"jcgo/internal/katago"
)

type ClientRuntime interface {
	Info() Info
	Configure(context.Context, RuntimeConfig) (Info, error)
	Analyze(context.Context, katago.Query) (katago.Result, error)
}

type ClientProgressRuntime interface {
	AnalyzeWithProgress(context.Context, katago.Query, func(katago.Result)) (katago.Result, error)
}

func ServeConnection(ctx context.Context, serverURL string, accessToken string, runtime ClientRuntime) error {
	dialer := websocket.Dialer{Subprotocols: []string{Subprotocol, "token." + accessToken}}
	conn, _, err := dialer.DialContext(ctx, serverURL, nil)
	if err != nil {
		return err
	}
	defer conn.Close()

	info := runtime.Info()
	if err := conn.WriteJSON(Envelope{Type: MessageRegister, Worker: &info}); err != nil {
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
				_ = conn.WriteJSON(Envelope{Type: MessageError, ID: msg.ID, Error: "analyze query is required"})
				continue
			}
			if err := analyzeAndReply(ctx, conn, msg.ID, *msg.Query, runtime); err != nil {
				return err
			}
		case MessageConfigure:
			if msg.Config == nil {
				_ = conn.WriteJSON(Envelope{Type: MessageError, ID: msg.ID, Error: "configure config is required"})
				continue
			}
			info, err := runtime.Configure(ctx, *msg.Config)
			if err != nil {
				_ = conn.WriteJSON(Envelope{Type: MessageError, ID: msg.ID, Error: err.Error()})
				continue
			}
			if err := conn.WriteJSON(Envelope{Type: MessageStatus, ID: msg.ID, Worker: &info}); err != nil {
				return err
			}
		default:
			_ = conn.WriteJSON(Envelope{Type: MessageError, ID: msg.ID, Error: fmt.Sprintf("unexpected message %q", msg.Type)})
		}
	}
}

func analyzeAndReply(ctx context.Context, conn *websocket.Conn, id string, query katago.Query, runtime ClientRuntime) error {
	writeResult := func(result katago.Result) {
		_ = conn.WriteJSON(Envelope{Type: MessageResult, ID: id, Result: &result})
	}

	var (
		result katago.Result
		err    error
	)
	if progressEngine, ok := runtime.(ClientProgressRuntime); ok {
		result, err = progressEngine.AnalyzeWithProgress(ctx, query, writeResult)
	} else {
		result, err = runtime.Analyze(ctx, query)
	}
	if err != nil {
		if writeErr := conn.WriteJSON(Envelope{Type: MessageError, ID: id, Error: err.Error()}); writeErr != nil {
			return errors.Join(err, writeErr)
		}
		return nil
	}
	return conn.WriteJSON(Envelope{Type: MessageResult, ID: id, Result: &result})
}
