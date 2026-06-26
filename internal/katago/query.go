package katago

type Move struct {
	Player string
	Move   string
}

type Stone = Move

type Query struct {
	ID                      string         `json:"id"`
	Rules                   string         `json:"rules"`
	Priority                int            `json:"priority"`
	AnalyzeTurns            []int          `json:"analyzeTurns"`
	MaxVisits               int            `json:"maxVisits"`
	ReportDuringSearchEvery float64        `json:"reportDuringSearchEvery,omitempty"`
	Komi                    float64        `json:"komi"`
	BoardXSize              int            `json:"boardXSize"`
	BoardYSize              int            `json:"boardYSize"`
	IncludeOwnership        bool           `json:"includeOwnership"`
	IncludeMovesOwnership   bool           `json:"includeMovesOwnership"`
	IncludePolicy           bool           `json:"includePolicy"`
	InitialStones           [][2]string    `json:"initialStones"`
	InitialPlayer           string         `json:"initialPlayer"`
	Moves                   [][2]string    `json:"moves"`
	OverrideSettings        map[string]any `json:"overrideSettings,omitempty"`
}

type BuildInput struct {
	ID            string
	Rules         string
	Komi          float64
	MaxVisits     int
	InitialStones []Stone
	InitialPlayer string
	Moves         []Move
	AnalyzeTurn   int
}

func BuildQuery(in BuildInput) Query {
	query := Query{
		ID:                      in.ID,
		Rules:                   in.Rules,
		AnalyzeTurns:            []int{in.AnalyzeTurn},
		MaxVisits:               in.MaxVisits,
		ReportDuringSearchEvery: 1,
		Komi:                    in.Komi,
		BoardXSize:              19,
		BoardYSize:              19,
		IncludeOwnership:        true,
		IncludeMovesOwnership:   false,
		IncludePolicy:           true,
		InitialStones:           make([][2]string, 0),
		InitialPlayer:           initialPlayer(in.InitialPlayer),
		Moves:                   make([][2]string, 0),
	}
	for _, stone := range in.InitialStones {
		query.InitialStones = append(query.InitialStones, [2]string{stone.Player, stone.Move})
	}
	for _, move := range in.Moves {
		query.Moves = append(query.Moves, [2]string{move.Player, move.Move})
	}
	return query
}

func initialPlayer(player string) string {
	if player == "W" {
		return "W"
	}
	return "B"
}
