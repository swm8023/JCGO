package game

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode"
)

type Move struct {
	Player Color
	GTP    string
	Pass   bool
}

type SetupStone struct {
	Player Color
	GTP    string
}

type SGFDocument struct {
	BoardSize     int
	Rules         string
	Komi          float64
	Result        string
	BlackName     string
	WhiteName     string
	InitialStones []SetupStone
	Mainline      []Move
}

func ParseSGF(input string) (SGFDocument, error) {
	nodes, err := parseSGFMainlineNodes(input)
	if err != nil {
		return SGFDocument{}, err
	}
	if len(nodes) == 0 {
		return SGFDocument{}, errors.New("sgf contains no nodes")
	}

	root := nodes[0]
	doc := SGFDocument{
		BoardSize: 19,
		Rules:     "chinese",
		Komi:      7.5,
		Result:    first(root["RE"]),
		BlackName: first(root["PB"]),
		WhiteName: first(root["PW"]),
	}
	if size := first(root["SZ"]); size != "" {
		parsed, err := strconv.Atoi(size)
		if err != nil || parsed != 19 {
			return SGFDocument{}, fmt.Errorf("only 19x19 SGF is supported")
		}
		doc.BoardSize = parsed
	}
	if rules := first(root["RU"]); rules != "" {
		doc.Rules = strings.ToLower(rules)
	}
	if komi := first(root["KM"]); komi != "" {
		parsed, err := strconv.ParseFloat(komi, 64)
		if err != nil {
			return SGFDocument{}, fmt.Errorf("invalid komi %q", komi)
		}
		doc.Komi = parsed
	}

	for _, raw := range root["AB"] {
		gtp, pass, err := sgfCoordToGTP(raw, doc.BoardSize)
		if err != nil {
			return SGFDocument{}, err
		}
		if pass {
			return SGFDocument{}, fmt.Errorf("invalid setup stone %q", raw)
		}
		doc.InitialStones = append(doc.InitialStones, SetupStone{Player: Black, GTP: gtp})
	}
	for _, raw := range root["AW"] {
		gtp, pass, err := sgfCoordToGTP(raw, doc.BoardSize)
		if err != nil {
			return SGFDocument{}, err
		}
		if pass {
			return SGFDocument{}, fmt.Errorf("invalid setup stone %q", raw)
		}
		doc.InitialStones = append(doc.InitialStones, SetupStone{Player: White, GTP: gtp})
	}

	for i, node := range nodes[1:] {
		if len(node["AB"]) > 0 || len(node["AW"]) > 0 || len(node["AE"]) > 0 {
			return SGFDocument{}, fmt.Errorf("unsupported setup property outside root at node %d", i+1)
		}
		if values := node["B"]; len(values) > 0 {
			move, err := sgfMove(Black, values[0], doc.BoardSize)
			if err != nil {
				return SGFDocument{}, err
			}
			doc.Mainline = append(doc.Mainline, move)
		}
		if values := node["W"]; len(values) > 0 {
			move, err := sgfMove(White, values[0], doc.BoardSize)
			if err != nil {
				return SGFDocument{}, err
			}
			doc.Mainline = append(doc.Mainline, move)
		}
	}
	return doc, nil
}

type sgfNode map[string][]string

type sgfScanner struct {
	input string
	pos   int
}

func parseSGFMainlineNodes(input string) ([]sgfNode, error) {
	scanner := sgfScanner{input: strings.TrimSpace(input)}
	scanner.skipSpace()
	if !scanner.consume('(') {
		return nil, errors.New("sgf must start with a game tree")
	}
	nodes, err := scanner.parseSequence()
	if err != nil {
		return nil, err
	}
	if err := scanner.skipGameTreeRest(); err != nil {
		return nil, err
	}
	return nodes, nil
}

func (s *sgfScanner) parseSequence() ([]sgfNode, error) {
	var nodes []sgfNode
	for {
		s.skipSpace()
		if s.done() {
			return nil, errors.New("sgf ended before closing game tree")
		}
		switch s.peek() {
		case ';':
			node, err := s.parseNode()
			if err != nil {
				return nil, err
			}
			nodes = append(nodes, node)
		case '(', ')':
			return nodes, nil
		default:
			return nil, fmt.Errorf("unexpected SGF character %q", s.peek())
		}
	}
}

func (s *sgfScanner) parseNode() (sgfNode, error) {
	if !s.consume(';') {
		return nil, errors.New("expected SGF node")
	}
	node := sgfNode{}
	for {
		s.skipSpace()
		if s.done() || s.peek() == ';' || s.peek() == '(' || s.peek() == ')' {
			return node, nil
		}
		prop, err := s.readProperty()
		if err != nil {
			return nil, err
		}
		s.skipSpace()
		if s.done() || s.peek() != '[' {
			return nil, fmt.Errorf("property %s has no value", prop)
		}
		for !s.done() && s.peek() == '[' {
			value, err := s.readValue()
			if err != nil {
				return nil, err
			}
			if prop != "" {
				node[prop] = append(node[prop], value)
			}
			s.skipSpace()
		}
	}
}

func (s *sgfScanner) readProperty() (string, error) {
	start := s.pos
	for !s.done() {
		r := rune(s.peek())
		if !unicode.IsLetter(r) {
			break
		}
		s.pos++
	}
	if s.pos == start {
		return "", fmt.Errorf("expected SGF property at %d", start)
	}
	raw := s.input[start:s.pos]
	var normalized strings.Builder
	for _, r := range raw {
		if unicode.IsUpper(r) {
			normalized.WriteRune(r)
		}
	}
	return normalized.String(), nil
}

func (s *sgfScanner) readValue() (string, error) {
	if !s.consume('[') {
		return "", errors.New("expected SGF property value")
	}
	var value strings.Builder
	for !s.done() {
		ch := s.next()
		if ch == ']' {
			return value.String(), nil
		}
		if ch == '\\' {
			if s.done() {
				value.WriteByte(ch)
				return value.String(), nil
			}
			value.WriteByte(s.next())
			continue
		}
		value.WriteByte(ch)
	}
	return "", errors.New("unterminated SGF property value")
}

func (s *sgfScanner) skipGameTreeRest() error {
	depth := 1
	for !s.done() {
		ch := s.next()
		switch ch {
		case '[':
			if err := s.skipRawValue(); err != nil {
				return err
			}
		case '(':
			depth++
		case ')':
			depth--
			if depth == 0 {
				s.skipSpace()
				return nil
			}
		}
	}
	return errors.New("sgf ended before closing game tree")
}

func (s *sgfScanner) skipRawValue() error {
	for !s.done() {
		ch := s.next()
		if ch == ']' {
			return nil
		}
		if ch == '\\' && !s.done() {
			s.pos++
		}
	}
	return errors.New("unterminated SGF property value")
}

func (s *sgfScanner) skipSpace() {
	for !s.done() && unicode.IsSpace(rune(s.peek())) {
		s.pos++
	}
}

func (s *sgfScanner) consume(ch byte) bool {
	if s.done() || s.input[s.pos] != ch {
		return false
	}
	s.pos++
	return true
}

func (s *sgfScanner) next() byte {
	ch := s.input[s.pos]
	s.pos++
	return ch
}

func (s *sgfScanner) peek() byte {
	return s.input[s.pos]
}

func (s *sgfScanner) done() bool {
	return s.pos >= len(s.input)
}

func sgfMove(player Color, raw string, boardSize int) (Move, error) {
	gtp, pass, err := sgfCoordToGTP(raw, boardSize)
	if err != nil {
		return Move{}, err
	}
	return Move{Player: player, GTP: gtp, Pass: pass}, nil
}

func sgfCoordToGTP(raw string, boardSize int) (string, bool, error) {
	if raw == "" {
		return "pass", true, nil
	}
	if len(raw) != 2 {
		return "", false, fmt.Errorf("invalid SGF coordinate %q", raw)
	}
	if raw[0] < 'a' || raw[0] > 'z' || raw[1] < 'a' || raw[1] > 'z' {
		return "", false, fmt.Errorf("invalid SGF coordinate %q", raw)
	}
	x := int(raw[0] - 'a')
	y := int(raw[1] - 'a')
	if x >= boardSize || y >= boardSize {
		return "pass", true, nil
	}
	if x >= len(gtpLetters) {
		return "", false, fmt.Errorf("invalid GTP coordinate %q", raw)
	}
	return fmt.Sprintf("%c%d", gtpLetters[x], boardSize-y), false, nil
}

func first(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

const gtpLetters = "ABCDEFGHJKLMNOPQRST"
