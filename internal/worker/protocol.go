package worker

import "jcgo/internal/katago"

const (
	Subprotocol = "jcgo-worker"

	MessageRegister  = "register"
	MessageAnalyze   = "analyze"
	MessageConfigure = "configure"
	MessageStatus    = "status"
	MessageResult    = "result"
	MessageError     = "error"
)

type Info struct {
	Name               string `json:"name"`
	Platform           string `json:"platform"`
	KatagoPath         string `json:"katagoPath"`
	ModelPath          string `json:"modelPath"`
	AnalysisConfigPath string `json:"analysisConfigPath"`
	Backend            string `json:"backend,omitempty"`
	BackendLabel       string `json:"backendLabel,omitempty"`
	Model              string `json:"model,omitempty"`
	MaxVisits          int    `json:"maxVisits,omitempty"`
	Available          bool   `json:"available"`
	Error              string `json:"error,omitempty"`
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
