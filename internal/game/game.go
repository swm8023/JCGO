package game

import (
	"fmt"
	"strconv"
	"strings"
)

type Game struct {
	id       string
	rules    string
	komi     float64
	mainline []node
	current  int
}

type node struct {
	id         string
	parent     string
	moveNumber int
	color      Color
	gtp        string
	pass       bool
	board      board
	toPlay     Color
	captures   map[Color]int
	ko         *Point
	gameEnded  bool
}

func NewEmpty(id, rules string, komi float64) *Game {
	root := node{
		id:         "main:0",
		moveNumber: 0,
		toPlay:     Black,
		captures:   emptyCaptures(),
	}
	return &Game{id: id, rules: rules, komi: komi, mainline: []node{root}}
}

func NewFromSGF(id string, doc SGFDocument) (*Game, error) {
	g := NewEmpty(id, doc.Rules, doc.Komi)
	for _, stone := range doc.InitialStones {
		x, y, err := ParseGTP(stone.GTP)
		if err != nil {
			return nil, err
		}
		if err := g.mainline[0].board.placeSetup(stone.Player, x, y); err != nil {
			return nil, err
		}
	}
	if len(doc.Mainline) > 0 {
		g.mainline[0].toPlay = doc.Mainline[0].Player
	}

	prev := g.mainline[0]
	for i, move := range doc.Mainline {
		next, err := playNode(prev, move.Player, move.GTP, fmt.Sprintf("main:%d", i+1), i+1)
		if err != nil {
			return nil, err
		}
		g.mainline = append(g.mainline, next)
		prev = next
	}
	g.current = 0
	return g, nil
}

func (g *Game) GotoMain(moveNumber int) (Snapshot, error) {
	if moveNumber < 0 || moveNumber >= len(g.mainline) {
		return Snapshot{}, fmt.Errorf("move number out of range")
	}
	g.current = moveNumber
	return g.snapshot(g.mainline[g.current]), nil
}

func (g *Game) CurrentSnapshot() Snapshot {
	return g.snapshot(g.mainline[g.current])
}

func (g *Game) PlayVariation(color Color, gtp string) (Snapshot, error) {
	if g.current != len(g.mainline)-1 {
		return Snapshot{}, fmt.Errorf("variation play from earlier nodes is not implemented yet")
	}
	prev := g.mainline[g.current]
	next, err := playNode(prev, color, gtp, fmt.Sprintf("main:%d", len(g.mainline)), prev.moveNumber+1)
	if err != nil {
		return Snapshot{}, err
	}
	g.mainline = append(g.mainline, next)
	g.current = len(g.mainline) - 1
	return g.CurrentSnapshot(), nil
}

func (g *Game) snapshot(n node) Snapshot {
	var lastMove *MoveView
	if n.moveNumber > 0 {
		lastMove = &MoveView{
			NodeID:     n.id,
			MoveNumber: n.moveNumber,
			Color:      n.color,
			GTP:        n.gtp,
			Pass:       n.pass,
		}
	}
	return Snapshot{
		GameID:        g.id,
		NodeID:        n.id,
		MoveNumber:    n.moveNumber,
		TotalMoves:    len(g.mainline) - 1,
		BranchMode:    "main",
		Stones:        n.board.stones(),
		LastMove:      lastMove,
		ToPlay:        n.toPlay,
		Rules:         g.rules,
		Komi:          g.komi,
		Captures:      copyCaptures(n.captures),
		GameEnded:     n.gameEnded,
		CanPrevious:   n.moveNumber > 0,
		CanNext:       n.moveNumber < len(g.mainline)-1,
		CanBackToMain: false,
	}
}

func playNode(prev node, color Color, gtp string, id string, moveNumber int) (node, error) {
	if prev.gameEnded {
		return node{}, fmt.Errorf("game already ended")
	}
	if color != prev.toPlay {
		return node{}, fmt.Errorf("expected %s to play, got %s", prev.toPlay, color)
	}
	next := node{
		id:         id,
		parent:     prev.id,
		moveNumber: moveNumber,
		color:      color,
		board:      prev.board,
		toPlay:     opponent(color),
		captures:   copyCaptures(prev.captures),
	}
	if strings.EqualFold(strings.TrimSpace(gtp), "pass") {
		next.gtp = "pass"
		next.pass = true
		next.gameEnded = prev.pass
		return next, nil
	}

	x, y, err := ParseGTP(gtp)
	if err != nil {
		return node{}, err
	}
	captured, ko, err := next.board.play(color, x, y, prev.ko)
	if err != nil {
		return node{}, err
	}
	next.gtp = FormatGTP(x, y)
	next.captures[color] += captured
	next.ko = ko
	return next, nil
}

func ParseGTP(gtp string) (int, int, error) {
	value := strings.ToUpper(strings.TrimSpace(gtp))
	if value == "PASS" {
		return 0, 0, fmt.Errorf("pass has no board point")
	}
	if len(value) < 2 {
		return 0, 0, fmt.Errorf("invalid GTP coordinate %q", gtp)
	}
	x := strings.IndexByte(gtpLetters, value[0])
	if x < 0 {
		return 0, 0, fmt.Errorf("invalid GTP coordinate %q", gtp)
	}
	row, err := strconv.Atoi(value[1:])
	if err != nil || row < 1 || row > 19 {
		return 0, 0, fmt.Errorf("invalid GTP coordinate %q", gtp)
	}
	return x, 19 - row, nil
}

func FormatGTP(x, y int) string {
	return fmt.Sprintf("%c%d", gtpLetters[x], 19-y)
}

func opponent(color Color) Color {
	if color == Black {
		return White
	}
	return Black
}

func emptyCaptures() map[Color]int {
	return map[Color]int{Black: 0, White: 0}
}

func copyCaptures(captures map[Color]int) map[Color]int {
	copied := emptyCaptures()
	for color, count := range captures {
		copied[color] = count
	}
	return copied
}
