package app

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestParseReviewURL(t *testing.T) {
	tests := []struct {
		name      string
		url       string
		wantPlat  string
		wantSID   string
		wantErr   bool
		errSubstr string
	}{
		{
			name:     "standard yuanluobo URL",
			url:      "https://jupiter.yuanluobo.com/robot-public/all-in-app/go/review?session_id=58RG2WP0BC24L24008371783395050378&player_id=5NgtoZZRhdQ&link_id=489926",
			wantPlat: "yuanluobo",
			wantSID:  "58RG2WP0BC24L24008371783395050378",
		},
		{
			name:     "yuanluobo with extra params",
			url:      "https://jupiter.yuanluobo.com/review?session_id=ABC123&other=1",
			wantPlat: "yuanluobo",
			wantSID:  "ABC123",
		},
		{
			name:     "foxwq completed game share",
			url:      "https://h5.foxwq.com/yehunewshare/?chessid=1783550274030026339&boardsize=19&uid=533039915",
			wantPlat: "foxwq",
			wantSID:  "1783550274030026339",
		},
		{
			name:      "foxwq missing chessid",
			url:       "https://h5.foxwq.com/yehunewshare/?boardsize=19",
			wantErr:   true,
			errSubstr: "chessid not found",
		},
		{
			name:      "foxwq unsupported share path",
			url:       "https://h5.foxwq.com/txwqshare/index.html?chessid=1783550274030026339",
			wantErr:   true,
			errSubstr: "unsupported URL",
		},
		{
			name:      "foxwq lookalike domain",
			url:       "https://h5.foxwq.com.example.com/yehunewshare/?chessid=1783550274030026339",
			wantErr:   true,
			errSubstr: "unsupported URL host",
		},
		{
			name:      "foxwq insecure scheme",
			url:       "http://h5.foxwq.com/yehunewshare/?chessid=1783550274030026339",
			wantErr:   true,
			errSubstr: "unsupported URL scheme",
		},
		{
			name:      "unsupported domain",
			url:       "https://example.com/review?session_id=abc",
			wantErr:   true,
			errSubstr: "unsupported URL host",
		},
		{
			name:      "yuanluobo missing session_id",
			url:       "https://jupiter.yuanluobo.com/review?player_id=abc",
			wantErr:   true,
			errSubstr: "session_id not found",
		},
		{
			name:      "invalid URL",
			url:       "://invalid",
			wantErr:   true,
			errSubstr: "invalid URL",
		},
		{
			name:      "empty string",
			url:       "",
			wantErr:   true,
			errSubstr: "unsupported URL host",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			platform, sessionID, err := parseReviewURL(tt.url)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error containing %q, got nil", tt.errSubstr)
				}
				if tt.errSubstr != "" && !containsStr(err.Error(), tt.errSubstr) {
					t.Fatalf("expected error containing %q, got %q", tt.errSubstr, err.Error())
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if platform != tt.wantPlat {
				t.Errorf("platform = %q, want %q", platform, tt.wantPlat)
			}
			if sessionID != tt.wantSID {
				t.Errorf("sessionID = %q, want %q", sessionID, tt.wantSID)
			}
		})
	}
}

func TestNormalizeFoxwqSGFChineseGame(t *testing.T) {
	raw := "(;GM[1]FF[4]SZ[19]DT[2026-07-09]PB[苏景澄]PW[V415720364]BR[10级]WR[10级]KM[375]HA[0]RU[Chinese]RE[W+19.25];B[pd];W[ag])"

	sgf, displayName, err := normalizeFoxwqSGF(raw)
	if err != nil {
		t.Fatalf("normalizeFoxwqSGF() error = %v", err)
	}
	if displayName != "苏景澄 vs V415720364" {
		t.Fatalf("displayName = %q", displayName)
	}
	for _, want := range []string{
		"KM[7.5]",
		"RE[W+38.50]",
		"BR[10级]WR[10级]",
		";B[pd];W[ag]",
	} {
		if !containsStr(sgf, want) {
			t.Errorf("normalized SGF missing %q:\n%s", want, sgf)
		}
	}
}

func TestNormalizeFoxwqSGFJapaneseGame(t *testing.T) {
	raw := "(;GM[1]FF[4]SZ[19]PB[Black]PW[White]KM[650]HA[0]RU[Japanese]RE[B+R];B[pd])"

	sgf, _, err := normalizeFoxwqSGF(raw)
	if err != nil {
		t.Fatalf("normalizeFoxwqSGF() error = %v", err)
	}
	for _, want := range []string{"KM[6.5]", "RE[B+R]"} {
		if !containsStr(sgf, want) {
			t.Errorf("normalized SGF missing %q:\n%s", want, sgf)
		}
	}
}

func TestNormalizeFoxwqSGFNonNumericResults(t *testing.T) {
	tests := []struct {
		name   string
		result string
		want   string
	}{
		{name: "resignation", result: "B+R", want: "RE[B+R]"},
		{name: "draw", result: "draw", want: "RE[Draw]"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			raw := "(;GM[1]FF[4]SZ[19]PB[Black]PW[White]KM[375]RU[Chinese]RE[" + tt.result + "];B[pd])"
			sgf, _, err := normalizeFoxwqSGF(raw)
			if err != nil {
				t.Fatalf("normalizeFoxwqSGF() error = %v", err)
			}
			if !containsStr(sgf, tt.want) {
				t.Fatalf("normalized SGF missing %q: %s", tt.want, sgf)
			}
		})
	}
}

func TestNormalizeFoxwqSGFAllowsEscapedSemicolonInRoot(t *testing.T) {
	raw := `(;GM[1]FF[4]SZ[19]GN[Final\; round]PB[Black]PW[White]KM[375]RU[Chinese]RE[B+R];B[pd])`

	sgf, _, err := normalizeFoxwqSGF(raw)
	if err != nil {
		t.Fatalf("normalizeFoxwqSGF() error = %v", err)
	}
	if !containsStr(sgf, `GN[Final\; round]`) || !containsStr(sgf, "KM[7.5]") {
		t.Fatalf("normalized SGF = %s", sgf)
	}
}

func TestFetchFoxwqSGF(t *testing.T) {
	const chessID = "1783550274030026339"
	raw := "(;GM[1]FF[4]SZ[19]PB[苏景澄]PW[V415720364]KM[375]RU[Chinese]RE[W+19.25];B[pd];W[ag])"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("method = %s", r.Method)
		}
		if got := r.URL.Query().Get("chessid"); got != chessID {
			t.Errorf("chessid = %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"result":0,"chessid":%q,"flag":1,"chess":%q}`, chessID, raw)
	}))
	defer server.Close()

	sgf, displayName, err := fetchFoxwqSGFAt(chessID, server.URL)
	if err != nil {
		t.Fatalf("fetchFoxwqSGFAt() error = %v", err)
	}
	if displayName != "苏景澄 vs V415720364" {
		t.Fatalf("displayName = %q", displayName)
	}
	if !containsStr(sgf, "KM[7.5]") || !containsStr(sgf, "RE[W+38.50]") {
		t.Fatalf("normalized SGF = %s", sgf)
	}
}

func TestFetchFoxwqSGFRejectsInvalidResponses(t *testing.T) {
	const chessID = "1783550274030026339"
	validSGF := "(;GM[1]FF[4]SZ[19]PB[Black]PW[White]KM[375]RU[Chinese]RE[W+R];B[pd])"
	tests := []struct {
		name       string
		statusCode int
		body       string
		wantError  string
	}{
		{
			name:       "API error result",
			statusCode: http.StatusOK,
			body:       fmt.Sprintf(`{"result":12,"chessid":%q,"chess":%q}`, chessID, validSGF),
			wantError:  "result 12",
		},
		{
			name:       "mismatched chessid",
			statusCode: http.StatusOK,
			body:       fmt.Sprintf(`{"result":0,"chessid":"0","chess":%q}`, validSGF),
			wantError:  "chessid",
		},
		{
			name:       "empty SGF",
			statusCode: http.StatusOK,
			body:       fmt.Sprintf(`{"result":0,"chessid":%q,"chess":""}`, chessID),
			wantError:  "empty SGF",
		},
		{
			name:       "invalid board size",
			statusCode: http.StatusOK,
			body:       fmt.Sprintf(`{"result":0,"chessid":%q,"chess":%q}`, chessID, "(;GM[1]FF[4]SZ[0]KM[0]RU[Japanese]RE[draw])"),
			wantError:  "only 19x19 SGF is supported",
		},
		{
			name:       "HTTP error",
			statusCode: http.StatusServiceUnavailable,
			body:       "unavailable",
			wantError:  "status 503",
		},
		{
			name:       "invalid JSON",
			statusCode: http.StatusOK,
			body:       "{",
			wantError:  "failed to parse FoxWQ API response",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tt.statusCode)
				fmt.Fprint(w, tt.body)
			}))
			defer server.Close()

			_, _, err := fetchFoxwqSGFAt(chessID, server.URL)
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tt.wantError)
			}
			if !containsStr(err.Error(), tt.wantError) {
				t.Fatalf("error = %q, want substring %q", err, tt.wantError)
			}
		})
	}
}

func TestFetchFromURLDispatchesFoxwqShare(t *testing.T) {
	const chessID = "1783550274030026339"
	raw := "(;GM[1]FF[4]SZ[19]PB[苏景澄]PW[V415720364]KM[375]RU[Chinese]RE[W+19.25];B[pd])"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprintf(w, `{"result":0,"chessid":%q,"chess":%q}`, chessID, raw)
	}))
	defer server.Close()

	shareURL := "https://h5.foxwq.com/yehunewshare/?chessid=" + chessID + "&boardsize=19"
	sgf, displayName, err := fetchFromURLAt(shareURL, server.URL)
	if err != nil {
		t.Fatalf("fetchFromURLAt() error = %v", err)
	}
	if displayName != "苏景澄 vs V415720364" || !containsStr(sgf, ";B[pd]") {
		t.Fatalf("result = %q, %q", displayName, sgf)
	}
}

func TestConvertYuanluoboToSGF(t *testing.T) {
	data := yuanluoboGameData{
		BlackPlayerName: "苏景澄",
		WhitePlayerName: "V268990357",
		GameRule:        1,
		Tsugi:           3.75,
		GridSize:        3,
		StartTime:       1783393548,
		Status:          1,
		WinPieces:       20.25,
		BlackNumber:     164,
		WhiteNumber:     197,
		Recording: yuanluoboRecording{
			Moves: []yuanluoboMove{
				{Coordinate: "B[pd]"},
				{Coordinate: "W[dp]"},
				{Coordinate: "B[pp]"},
			},
		},
	}

	sgf := convertYuanluoboToSGF(data)

	assertions := []struct {
		name   string
		substr string
	}{
		{"board size", "SZ[19]"},
		{"komi", "KM[7.5]"},
		{"black player", "PB[苏景澄]"},
		{"white player", "PW[V268990357]"},
		{"result", "RE[W+40.50]"},
		{"rules", "RU[chinese]"},
		{"moves", ";B[pd];W[dp];B[pp]"},
	}

	for _, a := range assertions {
		t.Run(a.name, func(t *testing.T) {
			if !containsStr(sgf, a.substr) {
				t.Errorf("expected %q in SGF, got:\n%s", a.substr, sgf)
			}
		})
	}
}

func TestYuanluoboBoardSize(t *testing.T) {
	tests := []struct {
		gridSize int
		want     int
	}{
		{1, 9},
		{2, 13},
		{3, 19},
		{0, 19},
		{99, 19},
	}
	for _, tt := range tests {
		t.Run(fmt.Sprintf("gridSize_%d", tt.gridSize), func(t *testing.T) {
			if got := yuanluoboBoardSize(tt.gridSize); got != tt.want {
				t.Errorf("yuanluoboBoardSize(%d) = %d, want %d", tt.gridSize, got, tt.want)
			}
		})
	}
}

func TestFormatYuanluoboResult(t *testing.T) {
	tests := []struct {
		name string
		data yuanluoboGameData
		want string
	}{
		{
			name: "black wins by points",
			data: yuanluoboGameData{Status: 2, WinPieces: 50.5, BlackNumber: 231, WhiteNumber: 130},
			want: "B+101.00",
		},
		{
			name: "white wins by points",
			data: yuanluoboGameData{Status: 1, WinPieces: 20.25, BlackNumber: 164, WhiteNumber: 197},
			want: "W+40.50",
		},
		{
			name: "black wins by resignation",
			data: yuanluoboGameData{Status: 2, WinPieces: 0},
			want: "B+R",
		},
		{
			name: "white wins by resignation",
			data: yuanluoboGameData{Status: 1, WinPieces: 0},
			want: "W+R",
		},
		{
			name: "draw",
			data: yuanluoboGameData{WinPieces: 0},
			want: "Draw",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := formatYuanluoboResult(tt.data); got != tt.want {
				t.Errorf("formatYuanluoboResult() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestFormatYuanluoboResultDisplay(t *testing.T) {
	tests := []struct {
		name       string
		data       yuanluoboGameData
		wantLabel  string
		wantWinner string
	}{
		{"black wins by points", yuanluoboGameData{Status: 2, WinPieces: 50.5, BlackNumber: 231, WhiteNumber: 130}, "黑胜 101目", "B"},
		{"white wins by points", yuanluoboGameData{Status: 1, WinPieces: 20.25, BlackNumber: 164, WhiteNumber: 197}, "白胜 40.5目", "W"},
		{"black wins by resignation", yuanluoboGameData{Status: 2, WinPieces: 0}, "黑中盘胜", "B"},
		{"white wins by resignation", yuanluoboGameData{Status: 1, WinPieces: 0}, "白中盘胜", "W"},
		{"draw", yuanluoboGameData{WinPieces: 0}, "和棋", "draw"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := formatYuanluoboResultLabel(tt.data); got != tt.wantLabel {
				t.Errorf("formatYuanluoboResultLabel() = %q, want %q", got, tt.wantLabel)
			}
			if got := yuanluoboResultWinner(tt.data); got != tt.wantWinner {
				t.Errorf("yuanluoboResultWinner() = %q, want %q", got, tt.wantWinner)
			}
		})
	}
}
