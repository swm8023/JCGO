package game

type Color string

const (
	Black Color = "B"
	White Color = "W"
)

type Point struct {
	X int `json:"x"`
	Y int `json:"y"`
}

type Stone struct {
	X     int   `json:"x"`
	Y     int   `json:"y"`
	Color Color `json:"color"`
}

type MoveView struct {
	NodeID     string `json:"nodeId"`
	MoveNumber int    `json:"moveNumber"`
	Color      Color  `json:"color"`
	GTP        string `json:"gtp"`
	Pass       bool   `json:"pass"`
}

type Snapshot struct {
	GameID        string        `json:"gameId"`
	NodeID        string        `json:"nodeId"`
	MoveNumber    int           `json:"moveNumber"`
	TotalMoves    int           `json:"totalMoves"`
	BranchMode    string        `json:"branchMode"`
	Stones        []Stone       `json:"stones"`
	LastMove      *MoveView     `json:"lastMove,omitempty"`
	ToPlay        Color         `json:"toPlay"`
	Rules         string        `json:"rules"`
	Komi          float64       `json:"komi"`
	Captures      map[Color]int `json:"captures"`
	GameEnded     bool          `json:"gameEnded"`
	CanPrevious   bool          `json:"canPrevious"`
	CanNext       bool          `json:"canNext"`
	CanBackToMain bool          `json:"canBackToMain"`
}
