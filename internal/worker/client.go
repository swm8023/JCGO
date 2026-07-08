package worker

import (
	"context"
	"errors"
	"fmt"

	"github.com/gorilla/websocket"

	"jcgo/internal/katago"
)

func ServeConnection(ctx context.Context, serverURL string, accessToken string, info Info, engine katago.Analyzer) error {
	dialer := websocket.Dialer{Subprotocols: []string{Subprotocol, "token." + accessToken}}
	conn, _, err := dialer.DialContext(ctx, serverURL, nil)
	if err != nil {
		return err
	}
	defer conn.Close()

	if err := conn.WriteJSON(Envelope{Type: MessageRegister, Worker: &info}); err != nil {
		return err
	}

	for {
		var msg Envelope
		if err := conn.ReadJSON(&msg); err != nil {
			return err
		}
		if msg.Type != MessageAnalyze || msg.Query == nil {
			_ = conn.WriteJSON(Envelope{Type: MessageError, ID: msg.ID, Error: fmt.Sprintf("unexpected message %q", msg.Type)})
			continue
		}
		if err := analyzeAndReply(ctx, conn, msg.ID, *msg.Query, engine); err != nil {
			return err
		}
	}
}

func analyzeAndReply(ctx context.Context, conn *websocket.Conn, id string, query katago.Query, engine katago.Analyzer) error {
	writeResult := func(result katago.Result) {
		_ = conn.WriteJSON(Envelope{Type: MessageResult, ID: id, Result: &result})
	}

	var (
		result katago.Result
		err    error
	)
	if progressEngine, ok := engine.(katago.ProgressAnalyzer); ok {
		result, err = progressEngine.AnalyzeWithProgress(ctx, query, writeResult)
	} else {
		result, err = engine.Analyze(ctx, query)
	}
	if err != nil {
		if writeErr := conn.WriteJSON(Envelope{Type: MessageError, ID: id, Error: err.Error()}); writeErr != nil {
			return errors.Join(err, writeErr)
		}
		return nil
	}
	return conn.WriteJSON(Envelope{Type: MessageResult, ID: id, Result: &result})
}
