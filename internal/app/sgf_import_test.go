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
		WinPieces:       20.25,
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
		{"komi", "KM[3.8]"},
		{"black player", "PB[苏景澄]"},
		{"white player", "PW[V268990357]"},
		{"result", "RE[W+20.25]"},
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
		name    string
		winRate float64
		want    string
	}{
		{"white wins", 20.25, "W+20.25"},
		{"black wins", -15.5, "B+15.50"},
		{"draw", 0, "Draw"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data := yuanluoboGameData{WinPieces: tt.winRate}
			if got := formatYuanluoboResult(data); got != tt.want {
				t.Errorf("formatYuanluoboResult() = %q, want %q", got, tt.want)
			}
		})
	}
}
