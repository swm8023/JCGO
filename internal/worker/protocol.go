package worker

import "jcgo/internal/katago"

const (
	Subprotocol = "jcgo-worker"

	MessageRegister = "register"
	MessageAnalyze  = "analyze"
	MessageStatus   = "status"
	MessageResult   = "result"
	MessageError    = "error"
)

type Info struct {
	Name     string   `json:"name"`
	Platform string   `json:"platform"`
	Backend  string   `json:"backend,omitempty"`
	CPU      string   `json:"cpu,omitempty"`
	GPUs     []string `json:"gpus,omitempty"`
	Error    string   `json:"error,omitempty"`
}

type Envelope struct {
	Type   string         `json:"type"`
	ID     string         `json:"id,omitempty"`
	Worker *Info          `json:"worker,omitempty"`
	Config *RuntimeConfig `json:"config,omitempty"`
	Query  *katago.Query  `json:"query,omitempty"`
	Result *katago.Result `json:"result,omitempty"`
	Error  string         `json:"error,omitempty"`
}
