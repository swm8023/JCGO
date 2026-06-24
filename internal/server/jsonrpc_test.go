package server

import (
	"encoding/json"
	"testing"
)

func TestDecodeRequest(t *testing.T) {
	var req Request
	err := json.Unmarshal([]byte(`{"jsonrpc":"2.0","id":"7","method":"game.list","params":{"x":1}}`), &req)
	if err != nil {
		t.Fatal(err)
	}
	if req.Method != "game.list" || string(req.ID) != `"7"` {
		t.Fatalf("decoded request = %#v", req)
	}
}

func TestErrorResponseShape(t *testing.T) {
	resp := ErrorResponse("7", CodeInvalidRequest, "bad request")
	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"jsonrpc":"2.0","id":"7","error":{"code":-32600,"message":"bad request"}}`
	if string(data) != want {
		t.Fatalf("json = %s", data)
	}
}
