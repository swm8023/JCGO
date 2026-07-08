package app

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const yuanluoboAPIEndpoint = "https://jupiter.yuanluobo.com/r2/chess/wq/sdr/v3/record/detail"

type yuanluoboResponse struct {
	Code    int               `json:"code"`
	Message string            `json:"message"`
	Data    yuanluoboGameData `json:"data"`
}

type yuanluoboGameData struct {
	SessionID       string             `json:"session_id"`
	BlackPlayerName string             `json:"black_player_name"`
	WhitePlayerName string             `json:"white_player_name"`
	GameRule        int                `json:"game_rule"`
	Tsugi           float64            `json:"tsugi"`
	GridSize        int                `json:"grid_size"`
	Status          int                `json:"status"`
	StartTime       int64              `json:"start_time"`
	WinPieces       float64            `json:"win_pieces"`
	FinalScore      float64            `json:"final_score"`
	BlackNumber     float64            `json:"black_number"`
	WhiteNumber     float64            `json:"white_number"`
	Recording       yuanluoboRecording `json:"recording"`
}

type yuanluoboRecording struct {
	Moves []yuanluoboMove `json:"moves"`
}

type yuanluoboMove struct {
	Coordinate string `json:"coordinate"`
}

// parseReviewURL extracts session_id from a review URL.
// Returns platform identifier and session_id, or error if URL is not supported.
func parseReviewURL(rawURL string) (platform string, sessionID string, err error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return "", "", fmt.Errorf("invalid URL: %w", err)
	}

	host := strings.ToLower(u.Host)

	switch {
	case strings.Contains(host, "yuanluobo.com"):
		sid := u.Query().Get("session_id")
		if sid == "" {
			return "", "", fmt.Errorf("session_id not found in URL")
		}
		return "yuanluobo", sid, nil
	default:
		return "", "", fmt.Errorf("unsupported URL host: %s", host)
	}
}

// fetchFromURL dispatches to the appropriate platform fetcher based on URL domain.
func fetchFromURL(rawURL string) (sgf string, displayName string, err error) {
	platform, sessionID, err := parseReviewURL(rawURL)
	if err != nil {
		return "", "", err
	}

	switch platform {
	case "yuanluobo":
		return fetchYuanluoboSGF(sessionID)
	default:
		return "", "", fmt.Errorf("unsupported platform: %s", platform)
	}
}

// fetchYuanluoboSGF calls YuanluoBo API and returns SGF text and display name.
func fetchYuanluoboSGF(sessionID string) (sgf string, displayName string, err error) {
	reqBody, _ := json.Marshal(map[string]string{"sessionId": sessionID})
	resp, err := http.Post(yuanluoboAPIEndpoint, "application/json", bytes.NewReader(reqBody))
	if err != nil {
		return "", "", fmt.Errorf("failed to call YuanluoBo API: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", "", fmt.Errorf("failed to read API response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("YuanluoBo API returned status %d", resp.StatusCode)
	}

	var result yuanluoboResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return "", "", fmt.Errorf("failed to parse API response: %w", err)
	}

	if result.Code != 100000 {
		return "", "", fmt.Errorf("YuanluoBo API error: %s", result.Message)
	}

	sgf = convertYuanluoboToSGF(result.Data)
	displayName = yuanluoboDisplayName(result.Data)
	return sgf, displayName, nil
}

// convertYuanluoboToSGF converts YuanluoBo game data to SGF format.
func convertYuanluoboToSGF(data yuanluoboGameData) string {
	boardSize := yuanluoboBoardSize(data.GridSize)
	komi := data.Tsugi
	if komi == 0 {
		komi = 7.5
	}

	result := formatYuanluoboResult(data)
	date := time.Unix(data.StartTime, 0).UTC().Format("2006-01-02")
	rules := "chinese"
	if data.GameRule != 1 {
		rules = "japanese"
	}

	var moves strings.Builder
	for _, m := range data.Recording.Moves {
		moves.WriteString(";")
		moves.WriteString(m.Coordinate)
	}

	return fmt.Sprintf("(;GM[1]FF[4]CA[UTF-8]SZ[%d]KM[%.1f]\nPB[%s]PW[%s]\nRE[%s]DT[%s]\nRU[%s]\n%s)",
		boardSize, komi,
		data.BlackPlayerName, data.WhitePlayerName,
		result, date,
		rules,
		moves.String(),
	)
}

func yuanluoboBoardSize(gridSize int) int {
	switch gridSize {
	case 1:
		return 9
	case 2:
		return 13
	default:
		return 19
	}
}

func formatYuanluoboResult(data yuanluoboGameData) string {
	winner := yuanluoboResultWinner(data)
	if winner == "B" || winner == "W" {
		if margin := yuanluoboResultMargin(data); margin > 0 {
			return fmt.Sprintf("%s+%.2f", winner, margin)
		}
		return winner + "+R"
	}
	return "Draw"
}

func formatYuanluoboResultLabel(data yuanluoboGameData) string {
	switch yuanluoboResultWinner(data) {
	case "W":
		if margin := yuanluoboResultMargin(data); margin > 0 {
			return "白胜 " + formatYuanluoboScore(margin) + "子"
		}
		return "白中盘胜"
	case "B":
		if margin := yuanluoboResultMargin(data); margin > 0 {
			return "黑胜 " + formatYuanluoboScore(margin) + "子"
		}
		return "黑中盘胜"
	default:
		return "和棋"
	}
}

func yuanluoboResultWinner(data yuanluoboGameData) string {
	if data.BlackNumber > 0 || data.WhiteNumber > 0 {
		if data.BlackNumber > data.WhiteNumber {
			return "B"
		}
		if data.WhiteNumber > data.BlackNumber {
			return "W"
		}
	}
	switch data.Status {
	case 2:
		return "B"
	case 1:
		return "W"
	}
	if data.WinPieces < 0 {
		return "B"
	}
	if data.WinPieces > 0 {
		return "B"
	}
	return "draw"
}

func yuanluoboResultMargin(data yuanluoboGameData) float64 {
	if data.WinPieces != 0 {
		return absYuanluoboScore(data.WinPieces)
	}
	return absYuanluoboScore(data.FinalScore)
}

func formatYuanluoboScore(winPieces float64) string {
	return strconv.FormatFloat(absYuanluoboScore(winPieces), 'f', -1, 64)
}

func absYuanluoboScore(winPieces float64) float64 {
	if winPieces < 0 {
		return -winPieces
	}
	return winPieces
}

func yuanluoboDisplayName(data yuanluoboGameData) string {
	return fmt.Sprintf("%s vs %s", data.BlackPlayerName, data.WhitePlayerName)
}

// containsStr checks if substr exists in s.
func containsStr(s, substr string) bool {
	return len(s) >= len(substr) && searchString(s, substr)
}

func searchString(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
