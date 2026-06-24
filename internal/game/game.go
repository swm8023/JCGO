package game

import (
	"fmt"
	"strconv"
	"strings"
)

type Game struct {
	id               string
	rules            string
	komi             float64
	mainline         []node
	variations       map[string]node
	currentID        string
	variationCounter int
}

type node struct {
	id             string
	parent         string
	forkMoveNumber int
	moveNumber     int
	color          Color
	gtp            string
	pass           bool
	board          board
	toPlay         Color
	captures       map[Color]int
	ko             *Point
	gameEnded      bool
}

func NewEmpty(id, rules string, komi float64) *Game {
	root := node{
		id:             "main:0",
		forkMoveNumber: 0,
		moveNumber:     0,
		toPlay:         Black,
		captures:       emptyCaptures(),
	}
	return &Game{
		id:         id,
		rules:      rules,
		komi:       komi,
		mainline:   []node{root},
		variations: map[string]node{},
		currentID:  root.id,
	}
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
		next.forkMoveNumber = 0
		g.mainline = append(g.mainline, next)
		prev = next
	}
	g.currentID = "main:0"
	return g, nil
}

func (g *Game) GotoMain(moveNumber int) (Snapshot, error) {
	if moveNumber < 0 || moveNumber >= len(g.mainline) {
		return Snapshot{}, fmt.Errorf("move number out of range")
	}
	g.currentID = mainID(moveNumber)
	return g.CurrentSnapshot(), nil
}

func (g *Game) CurrentSnapshot() Snapshot {
	current, _ := g.node(g.currentID)
	return g.snapshot(current)
}

func (g *Game) PlayVariation(color Color, gtp string) (Snapshot, error) {
	prev, ok := g.node(g.currentID)
	if !ok {
		return Snapshot{}, fmt.Errorf("current node not found")
	}
	g.variationCounter++
	id := fmt.Sprintf("var:%d", g.variationCounter)
	next, err := playNode(prev, color, gtp, id, prev.moveNumber+1)
	if err != nil {
		g.variationCounter--
		return Snapshot{}, err
	}
	next.parent = prev.id
	next.forkMoveNumber = prev.forkMoveNumber
	if isMainID(prev.id) {
		next.forkMoveNumber = prev.moveNumber
	}
	g.variations[id] = next
	g.currentID = id
	return g.CurrentSnapshot(), nil
}

func (g *Game) BackToMain() (Snapshot, error) {
	current, ok := g.node(g.currentID)
	if !ok {
		return Snapshot{}, fmt.Errorf("current node not found")
	}
	if isMainID(current.id) {
		return g.snapshot(current), nil
	}
	g.currentID = mainID(current.forkMoveNumber)
	return g.CurrentSnapshot(), nil
}

func (g *Game) DeleteCurrentVariationNode() (Snapshot, error) {
	current, ok := g.node(g.currentID)
	if !ok {
		return Snapshot{}, fmt.Errorf("current node not found")
	}
	if isMainID(current.id) {
		return g.snapshot(current), nil
	}
	parentID := current.parent
	g.deleteVariationSubtree(current.id)
	g.currentID = parentID
	return g.CurrentSnapshot(), nil
}

func (g *Game) ClearCurrentVariation() (Snapshot, error) {
	current, ok := g.node(g.currentID)
	if !ok {
		return Snapshot{}, fmt.Errorf("current node not found")
	}
	if isMainID(current.id) {
		return g.snapshot(current), nil
	}
	forkMoveNumber := current.forkMoveNumber
	for id, variation := range g.variations {
		if variation.forkMoveNumber == forkMoveNumber {
			delete(g.variations, id)
		}
	}
	g.currentID = mainID(forkMoveNumber)
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
		BranchMode:    branchMode(n.id),
		Stones:        n.board.stones(),
		LastMove:      lastMove,
		ToPlay:        n.toPlay,
		Rules:         g.rules,
		Komi:          g.komi,
		Captures:      copyCaptures(n.captures),
		GameEnded:     n.gameEnded,
		CanPrevious:   n.parent != "",
		CanNext:       g.canNext(n),
		CanBackToMain: !isMainID(n.id),
	}
}

func (g *Game) node(id string) (node, bool) {
	if strings.HasPrefix(id, "main:") {
		index, err := strconv.Atoi(strings.TrimPrefix(id, "main:"))
		if err != nil || index < 0 || index >= len(g.mainline) {
			return node{}, false
		}
		return g.mainline[index], true
	}
	n, ok := g.variations[id]
	return n, ok
}

func (g *Game) canNext(n node) bool {
	if !isMainID(n.id) {
		return false
	}
	return n.moveNumber < len(g.mainline)-1
}

func (g *Game) deleteVariationSubtree(id string) {
	for childID, child := range g.variations {
		if child.parent == id {
			g.deleteVariationSubtree(childID)
		}
	}
	delete(g.variations, id)
}

func playNode(prev node, color Color, gtp string, id string, moveNumber int) (node, error) {
	if prev.gameEnded {
		return node{}, fmt.Errorf("game already ended")
	}
	if color != prev.toPlay {
		return node{}, fmt.Errorf("expected %s to play, got %s", prev.toPlay, color)
	}
	next := node{
		id:             id,
		parent:         prev.id,
		forkMoveNumber: prev.forkMoveNumber,
		moveNumber:     moveNumber,
		color:          color,
		board:          prev.board,
		toPlay:         opponent(color),
		captures:       copyCaptures(prev.captures),
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

func mainID(moveNumber int) string {
	return fmt.Sprintf("main:%d", moveNumber)
}

func isMainID(id string) bool {
	return strings.HasPrefix(id, "main:")
}

func branchMode(id string) string {
	if isMainID(id) {
		return "main"
	}
	return "variation"
}
