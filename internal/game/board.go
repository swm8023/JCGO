package game

import "fmt"

type board struct {
	grid [19][19]Color
}

func (b *board) placeSetup(color Color, x, y int) error {
	if !onBoard(x, y) {
		return fmt.Errorf("move outside board")
	}
	if b.grid[y][x] != "" {
		return fmt.Errorf("point occupied")
	}
	b.grid[y][x] = color
	return nil
}

func (b *board) play(color Color, x, y int, forbidden *Point) (int, *Point, error) {
	if !onBoard(x, y) {
		return 0, nil, fmt.Errorf("move outside board")
	}
	if forbidden != nil && forbidden.X == x && forbidden.Y == y {
		return 0, nil, fmt.Errorf("ko recapture is forbidden")
	}
	if b.grid[y][x] != "" {
		return 0, nil, fmt.Errorf("point occupied")
	}

	b.grid[y][x] = color
	var captured []Point
	for _, neighbor := range neighbors(Point{X: x, Y: y}) {
		if b.grid[neighbor.Y][neighbor.X] != opponent(color) {
			continue
		}
		group := b.group(neighbor)
		if len(b.liberties(group)) == 0 {
			captured = append(captured, group...)
			b.remove(group)
		}
	}

	ownGroup := b.group(Point{X: x, Y: y})
	ownLiberties := b.liberties(ownGroup)
	if len(ownLiberties) == 0 {
		return 0, nil, fmt.Errorf("suicide move")
	}

	var ko *Point
	if len(captured) == 1 && len(ownGroup) == 1 && len(ownLiberties) == 1 {
		koPoint := captured[0]
		ko = &koPoint
	}
	return len(captured), ko, nil
}

func (b board) stones() []Stone {
	var stones []Stone
	for y := 0; y < 19; y++ {
		for x := 0; x < 19; x++ {
			if b.grid[y][x] != "" {
				stones = append(stones, Stone{X: x, Y: y, Color: b.grid[y][x]})
			}
		}
	}
	return stones
}

func (b board) group(start Point) []Point {
	color := b.grid[start.Y][start.X]
	if color == "" {
		return nil
	}
	seen := map[Point]bool{start: true}
	stack := []Point{start}
	var group []Point
	for len(stack) > 0 {
		point := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		group = append(group, point)
		for _, next := range neighbors(point) {
			if seen[next] || b.grid[next.Y][next.X] != color {
				continue
			}
			seen[next] = true
			stack = append(stack, next)
		}
	}
	return group
}

func (b board) liberties(group []Point) map[Point]struct{} {
	liberties := map[Point]struct{}{}
	for _, stone := range group {
		for _, next := range neighbors(stone) {
			if b.grid[next.Y][next.X] == "" {
				liberties[next] = struct{}{}
			}
		}
	}
	return liberties
}

func (b *board) remove(group []Point) {
	for _, stone := range group {
		b.grid[stone.Y][stone.X] = ""
	}
}

func neighbors(point Point) []Point {
	candidates := []Point{
		{X: point.X - 1, Y: point.Y},
		{X: point.X + 1, Y: point.Y},
		{X: point.X, Y: point.Y - 1},
		{X: point.X, Y: point.Y + 1},
	}
	result := candidates[:0]
	for _, candidate := range candidates {
		if onBoard(candidate.X, candidate.Y) {
			result = append(result, candidate)
		}
	}
	return result
}

func onBoard(x, y int) bool {
	return x >= 0 && x < 19 && y >= 0 && y < 19
}
