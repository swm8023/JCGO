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
	Children      []MoveView    `json:"children"`
	ToPlay        Color         `json:"toPlay"`
	Rules         string        `json:"rules"`
	Komi          float64       `json:"komi"`
	BlackName     string        `json:"blackName"`
	WhiteName     string        `json:"whiteName"`
	Result        string        `json:"result"`
	Captures      map[Color]int `json:"captures"`
	GameEnded     bool          `json:"gameEnded"`
	CanPrevious   bool          `json:"canPrevious"`
	CanNext       bool          `json:"canNext"`
	CanBackToMain bool          `json:"canBackToMain"`
}

type AnalysisResult struct {
	Root        RootAnalysis   `json:"root"`
	Candidates  []CandidateRaw `json:"candidates"`
	OwnershipQ8 []byte         `json:"-"`
	Policy      []float64      `json:"policy,omitempty"`
}

type RootAnalysis struct {
	Winrate   float64 `json:"winrate"`
	ScoreLead float64 `json:"scoreLead"`
	Visits    int     `json:"visits"`
}

type CandidateRaw struct {
	Move      string   `json:"move"`
	Order     int      `json:"order"`
	Visits    int      `json:"visits"`
	Winrate   float64  `json:"winrate"`
	ScoreLead float64  `json:"scoreLead"`
	PV        []string `json:"pv"`
}

type BadMove struct {
	NodeID     string  `json:"nodeId"`
	MoveNumber int     `json:"moveNumber"`
	Color      Color   `json:"color"`
	Move       string  `json:"move"`
	PointLoss  float64 `json:"pointLoss"`
	Class      int     `json:"class"`
}

type ChartPoint struct {
	MoveNumber int     `json:"moveNumber"`
	Winrate    float64 `json:"winrate"`
	ScoreLead  float64 `json:"scoreLead"`
}
