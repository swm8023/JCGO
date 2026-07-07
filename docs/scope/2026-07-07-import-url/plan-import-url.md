# Import SGF from URL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend JCGO's SGF import to support URL-based import, starting with YuanluoBo (元萝卜) review links.

**Architecture:** Add `url` field to existing `game.importSgf` API. Backend parses URL by domain, calls platform API, converts to SGF, then follows existing import flow. Frontend adds "Import from URL" button in ImportDialog with URL input UI.

**Tech Stack:** Go (backend), TypeScript/React (frontend), HTTPS client for external API

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `internal/app/sgf_import.go` | Create | URL parsing, YuanluoBo API call, SGF conversion |
| `internal/app/sgf_import_test.go` | Create | Unit tests for URL parsing and SGF conversion |
| `internal/app/handlers.go:493-497` | Modify | Add `url` field to `importParams` |
| `internal/app/handlers.go:155-192` | Modify | Handle URL import in `importSGF` method |
| `web/src/components/ImportDialog.tsx` | Modify | Add URL import UI (two buttons, URL input) |

---

### Task 1: Backend - Create sgf_import.go with URL parsing

**Files:**
- Create: `internal/app/sgf_import.go`
- Create: `internal/app/sgf_import_test.go`

- [ ] **Step 1: Write URL parsing function and tests**

```go
// internal/app/sgf_import.go
package app

import (
	"fmt"
	"net/url"
	"strings"
)

// parseReviewURL extracts session_id from a YuanluoBo review URL.
// Returns session_id and platform identifier, or error if URL is not supported.
func parseReviewURL(rawURL string) (platform string, sessionID string, err error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return "", "", fmt.Errorf("invalid URL: %w", err)
	}

	host := strings.ToLower(u.Host)

	switch {
	case strings.Contains(host, "yuanluobo.com"):
		sessionID := u.Query().Get("session_id")
		if sessionID == "" {
			return "", "", fmt.Errorf("session_id not found in URL")
		}
		return "yuanluobo", sessionID, nil
	default:
		return "", "", fmt.Errorf("unsupported URL host: %s", host)
	}
}
```

```go
// internal/app/sgf_import_test.go
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
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `go test ./internal/app/ -run TestParseReviewURL -v`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add internal/app/sgf_import.go internal/app/sgf_import_test.go
git commit -m "feat: add URL parsing for YuanluoBo review links"
```

---

### Task 2: Backend - YuanluoBo API call and SGF conversion

**Files:**
- Modify: `internal/app/sgf_import.go`
- Modify: `internal/app/sgf_import_test.go`

- [ ] **Step 1: Add API response types and fetch function**

Add to `internal/app/sgf_import.go`:

```go
import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"time"
)

const yuanluoboAPIEndpoint = "https://jupiter.yuanluobo.com/r2/chess/wq/sdr/v3/record/detail"

type yuanluoboResponse struct {
	Code    int                `json:"code"`
	Message string             `json:"message"`
	Data    yuanluoboGameData  `json:"data"`
}

type yuanluoboGameData struct {
	SessionID       string              `json:"session_id"`
	BlackPlayerName string              `json:"black_player_name"`
	WhitePlayerName string              `json:"white_player_name"`
	GameRule        int                 `json:"game_rule"`
	Tsugi           float64             `json:"tsugi"`
	GridSize        int                 `json:"grid_size"`
	StartTime       int64               `json:"start_time"`
	WinPieces       float64             `json:"win_pieces"`
	Recording       yuanluoboRecording  `json:"recording"`
}

type yuanluoboRecording struct {
	Moves []yuanluoboMove `json:"moves"`
}

type yuanluoboMove struct {
	Coordinate string `json:"coordinate"`
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
	displayName = fmt.Sprintf("%s vs %s", result.Data.BlackPlayerName, result.Data.WhitePlayerName)
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
	if data.WinPieces > 0 {
		return fmt.Sprintf("W+%.2f", data.WinPieces)
	}
	if data.WinPieces < 0 {
		return fmt.Sprintf("B+%.2f", -data.WinPieces)
	}
	return "Draw"
}
```

- [ ] **Step 2: Add SGF conversion tests**

Add to `internal/app/sgf_import_test.go`:

```go
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
		name    string
		substr  string
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
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `go test ./internal/app/ -run "TestConvertYuanluoboToSGF|TestYuanluoboBoardSize|TestFormatYuanluoboResult" -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add internal/app/sgf_import.go internal/app/sgf_import_test.go
git commit -m "feat: add YuanluoBo API call and SGF conversion"
```

---

### Task 3: Backend - Integrate URL import into handlers.go

**Files:**
- Modify: `internal/app/handlers.go:493-497` (importParams struct)
- Modify: `internal/app/handlers.go:155-192` (importSGF method)

- [ ] **Step 1: Add url field to importParams**

In `internal/app/handlers.go`, change the `importParams` struct:

```go
type importParams struct {
	DisplayName      string `json:"displayName"`
	OriginalFilename string `json:"originalFilename,omitempty"`
	SGFText          string `json:"sgfText,omitempty"`
	URL              string `json:"url,omitempty"`
}
```

- [ ] **Step 2: Add fetchFromURL helper function**

Add to `internal/app/handlers.go` (or keep in sgf_import.go):

```go
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
```

- [ ] **Step 3: Modify importSGF to handle URL**

In `internal/app/handlers.go`, modify the `importSGF` method to handle URL input:

```go
func (h *Handler) importSGF(ctx context.Context, token string, params json.RawMessage) (ImportResult, error) {
	var in importParams
	if err := decodeParams(params, &in); err != nil {
		return ImportResult{}, err
	}

	var sgfText string
	var displayName string

	if in.URL != "" {
		// URL import mode
		fetchedSGF, fetchedName, err := fetchFromURL(in.URL)
		if err != nil {
			return ImportResult{}, err
		}
		sgfText = fetchedSGF
		displayName = fetchedName
	} else if in.SGFText != "" {
		// File import mode (existing)
		sgfText = in.SGFText
		displayName = strings.TrimSpace(in.DisplayName)
		if displayName == "" {
			return ImportResult{}, errors.New("displayName is required")
		}
	} else {
		return ImportResult{}, errors.New("either url or sgfText is required")
	}

	doc, err := game.ParseSGF(sgfText)
	if err != nil {
		return ImportResult{}, err
	}

	record, err := h.repo.CreateGame(ctx, store.CreateGameInput{
		DisplayName: displayName,
		Result:      doc.Result,
		GameDate:    doc.GameDate,
	})
	if err != nil {
		return ImportResult{}, err
	}

	record.AnalysisStatus = string(AnalysisIdle)
	if _, err := h.files.WriteSGF(record.SGFFilename, sgfText); err != nil {
		_ = h.repo.DeleteGame(ctx, record.ID)
		return ImportResult{}, err
	}

	ws := h.workspaces.ForToken(token)
	if err := ws.LoadGame(record.ID, doc); err != nil {
		_ = h.repo.DeleteGame(ctx, record.ID)
		_ = h.files.DeleteSGF(record.SGFFilename)
		return ImportResult{}, err
	}

	snapshot, err := ws.CurrentSnapshot(record.ID)
	if err != nil {
		return ImportResult{}, err
	}

	return ImportResult{Game: record, Snapshot: snapshot}, nil
}
```

- [ ] **Step 4: Run existing tests to verify no regression**

Run: `go test ./internal/app/ -v`
Expected: All existing tests PASS

- [ ] **Step 5: Commit**

```bash
git add internal/app/handlers.go
git commit -m "feat: integrate URL import into game.importSgf handler"
```

---

### Task 4: Frontend - Update ImportDialog with URL import UI

**Files:**
- Modify: `web/src/components/ImportDialog.tsx`

- [ ] **Step 1: Update ImportDialog component**

Replace the entire `web/src/components/ImportDialog.tsx` with:

```tsx
import { type ChangeEvent, useRef, useState } from 'react'

interface ImportDialogProps {
  onImport(displayName: string, originalFilename: string, sgfText: string): void
  onImportUrl(url: string): void
  onCancel(): void
}

type SGFPickerOptions = {
  id: string
  startIn: 'documents'
  multiple: false
  types: Array<{
    description: string
    accept: Record<string, string[]>
  }>
}

type FilePickerWindow = Window &
  typeof globalThis & {
    showOpenFilePicker?: (options: SGFPickerOptions) => Promise<Array<{ getFile(): Promise<File> }>>
  }

const sgfPickerOptions: SGFPickerOptions = {
  id: 'jcgo-sgf-import',
  startIn: 'documents',
  multiple: false,
  types: [
    {
      description: 'SGF files',
      accept: {
        'application/x-go-sgf': ['.sgf'],
        'text/plain': ['.sgf'],
      },
    },
  ],
}

type DialogMode = 'choose' | 'url'

export function ImportDialog({ onImport, onImportUrl, onCancel }: ImportDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<DialogMode>('choose')
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choose = () => {
    requestImportOrientation()
    const picker = (window as FilePickerWindow).showOpenFilePicker
    if (picker) {
      void chooseWithPicker(picker)
      return
    }
    window.addEventListener('focus', releaseImportOrientation, { once: true })
    inputRef.current?.click()
  }

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    try {
      if (file) await importFile(file, onImport)
    } finally {
      event.target.value = ''
      releaseImportOrientation()
    }
  }

  const cancel = () => {
    if (mode === 'url') {
      setMode('choose')
      setUrl('')
      setError(null)
      return
    }
    releaseImportOrientation()
    onCancel()
  }

  const handleUrlSubmit = async () => {
    if (!url.trim()) return
    setLoading(true)
    setError(null)
    try {
      onImportUrl(url.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败')
      setLoading(false)
    }
  }

  if (mode === 'url') {
    return (
      <div className="import-dialog" role="dialog" aria-label="Import from URL">
        <div className="import-dialog-body">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="粘贴元萝卜复盘链接"
            disabled={loading}
            autoFocus
          />
          {error && <div className="import-error">{error}</div>}
          <div className="import-dialog-actions">
            <button onClick={handleUrlSubmit} disabled={loading || !url.trim()}>
              {loading ? '导入中...' : '确认'}
            </button>
            <button onClick={cancel} disabled={loading}>取消</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="import-dialog" role="dialog" aria-label="Import SGF">
      <div className="import-dialog-body">
        <button onClick={choose}>选择 SGF 文件</button>
        <button onClick={() => setMode('url')}>从链接导入</button>
        <button onClick={cancel}>取消</button>
        <input ref={inputRef} type="file" accept=".sgf" hidden onChange={onFile} />
      </div>
    </div>
  )

  async function chooseWithPicker(picker: NonNullable<FilePickerWindow['showOpenFilePicker']>) {
    try {
      const [handle] = await picker(sgfPickerOptions)
      if (!handle) return
      await importFile(await handle.getFile(), onImport)
    } catch {
      // Users can cancel the native picker; unsupported orientation locks also fail silently.
    } finally {
      releaseImportOrientation()
    }
  }
}

async function importFile(file: File, onImport: ImportDialogProps['onImport']) {
  const defaultName = file.name.replace(/\.sgf$/i, '')
  const displayName = window.prompt('Game name', defaultName)?.trim()
  if (!displayName) return
  const sgfText = await file.text()
  onImport(displayName, file.name, sgfText)
}

function requestImportOrientation() {
  const orientation = screen.orientation as ScreenOrientation | undefined
  orientation?.lock?.('portrait')?.catch(() => undefined)
}

function releaseImportOrientation() {
  const orientation = screen.orientation as ScreenOrientation | undefined
  orientation?.unlock?.()
}
```

- [ ] **Step 2: Run frontend tests to verify no regression**

Run: `cd web && npm test -- --run`
Expected: All tests PASS (ImportDialog tests may need updating)

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ImportDialog.tsx
git commit -m "feat: add URL import UI to ImportDialog"
```

---

### Task 5: Frontend - Wire up URL import in App.tsx

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Add importFromUrl function**

In `web/src/App.tsx`, find the `importGame` function (around line 156) and add `importFromUrl`:

```typescript
const importGame = async (displayName: string, originalFilename: string, sgfText: string) => {
    await client.call('game.importSgf', { displayName, originalFilename, sgfText })
    // ... existing code ...
}

const importFromUrl = async (url: string) => {
    await client.call('game.importSgf', { url })
    // ... same success handling as importGame ...
}
```

- [ ] **Step 2: Update ImportDialog props**

Find the `<ImportDialog>` component usage and add the `onImportUrl` prop:

```tsx
<ImportDialog onImport={importGame} onImportUrl={importFromUrl} onCancel={() => setShowImport(false)} />
```

- [ ] **Step 3: Run frontend build to verify**

Run: `cd web && npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat: wire up URL import in App.tsx"
```

---

### Task 6: Integration test - Verify end-to-end flow

**Files:**
- None (manual testing)

- [ ] **Step 1: Start the server**

```powershell
$env:JCGO_ACCESS_TOKEN='dev-token'
$env:JCGO_DATA_DIR='.data'
go run ./cmd/jcgo
```

- [ ] **Step 2: Test URL import via browser**

1. Open http://localhost:8080
2. Click "+" button
3. Click "从链接导入"
4. Paste: `https://jupiter.yuanluobo.com/robot-public/all-in-app/go/review?session_id=58RG2WP0BC24L24008371783395050378&player_id=5NgtoZZRhdQ&link_id=489926`
5. Click "确认"
6. Verify: Game appears in list with name "苏景澄 vs V268990357"

- [ ] **Step 3: Test error handling**

1. Click "+" → "从链接导入"
2. Enter: `https://example.com/test`
3. Click "确认"
4. Verify: Error message "unsupported URL host: example.com"

- [ ] **Step 4: Run all tests**

```powershell
go test ./...
cd web && npm test -- --run
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: complete URL import for YuanluoBo review links"
```
