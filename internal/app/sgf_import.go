package app

import (
	"fmt"
	"net/url"
	"strings"
)

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
