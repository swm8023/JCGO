package app

import (
	"fmt"
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
