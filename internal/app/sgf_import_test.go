package app

import (
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
