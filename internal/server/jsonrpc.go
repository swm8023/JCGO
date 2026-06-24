package server

import "encoding/json"

const Version = "2.0"

const (
	CodeParseError     = -32700
	CodeInvalidRequest = -32600
	CodeMethodNotFound = -32601
	CodeInvalidParams  = -32602
	CodeInternalError  = -32603
)

type Request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type Response struct {
	JSONRPC string    `json:"jsonrpc"`
	ID      string    `json:"id,omitempty"`
	Result  any       `json:"result,omitempty"`
	Error   *RPCError `json:"error,omitempty"`
}

type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type Notification struct {
	JSONRPC string `json:"jsonrpc"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

func ResultResponse(id string, result any) Response {
	return Response{JSONRPC: Version, ID: id, Result: result}
}

func ErrorResponse(id string, code int, message string) Response {
	return Response{JSONRPC: Version, ID: id, Error: &RPCError{Code: code, Message: message}}
}

func Notify(method string, params any) Notification {
	return Notification{JSONRPC: Version, Method: method, Params: params}
}
