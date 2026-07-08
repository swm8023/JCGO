package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"jcgo/internal/store"
)

type YuanluoboRecordsResult struct {
	Total      int                       `json:"total"`
	Page       int                       `json:"page"`
	Size       int                       `json:"size"`
	PageTotal  int                       `json:"pageTotal"`
	Categories []YuanluoboRecordCategory `json:"categories"`
	Records    []YuanluoboRecordView     `json:"records"`
}

type YuanluoboRecordView struct {
	SessionID       string `json:"sessionId"`
	GameMode        int    `json:"gameMode"`
	Category        string `json:"category"`
	StartDate       string `json:"startDate"`
	StartTime       int64  `json:"startTime"`
	BlackPlayerName string `json:"blackPlayerName"`
	WhitePlayerName string `json:"whitePlayerName"`
	Title           string `json:"title"`
	Result          string `json:"result"`
	ResultLabel     string `json:"resultLabel"`
	ResultWinner    string `json:"resultWinner"`
	TotalRound      int    `json:"totalRound"`
	Imported        bool   `json:"imported"`
	GameID          string `json:"gameId,omitempty"`
}

type yuanluoboLoginPollParams struct {
	Key string `json:"key"`
}

type yuanluoboRecordsParams struct {
	PlayerID string `json:"playerId"`
	GameMode int    `json:"gameMode"`
	Page     int    `json:"page"`
}

type yuanluoboImportRecordParams struct {
	SessionID string `json:"sessionId"`
}

func (h *Handler) yuanluoboLoginStart(ctx context.Context) (YuanluoboQRCode, error) {
	return h.yuanluobo.LoginStart(ctx)
}

func (h *Handler) yuanluoboLoginPoll(ctx context.Context, params json.RawMessage) (YuanluoboLoginPoll, error) {
	var in yuanluoboLoginPollParams
	if err := decodeParams(params, &in); err != nil {
		return YuanluoboLoginPoll{}, err
	}
	if strings.TrimSpace(in.Key) == "" {
		return YuanluoboLoginPoll{}, errors.New("key is required")
	}
	return h.yuanluobo.LoginPoll(ctx, in.Key)
}

func (h *Handler) yuanluoboRecords(ctx context.Context, params json.RawMessage) (YuanluoboRecordsResult, error) {
	var in yuanluoboRecordsParams
	if err := decodeParams(params, &in); err != nil {
		return YuanluoboRecordsResult{}, err
	}
	records, err := h.yuanluobo.Records(ctx, YuanluoboRecordListRequest{
		Page:     in.Page,
		Size:     10,
		PlayerID: in.PlayerID,
		GameMode: in.GameMode,
	})
	if IsYuanluoboAuthInvalid(err) {
		_ = h.yuanluobo.ClearAuth(ctx)
	}
	if err != nil {
		return YuanluoboRecordsResult{}, err
	}
	out := YuanluoboRecordsResult{
		Total:      records.Total,
		Page:       records.Page,
		Size:       records.Size,
		PageTotal:  records.PageTotal,
		Categories: YuanluoboCategories(),
		Records:    make([]YuanluoboRecordView, 0, len(records.List)),
	}
	for _, item := range records.List {
		view := yuanluoboRecordView(item)
		existing, ok, err := h.repo.FindGameBySource(ctx, yuanluoboSourcePlatform, item.SessionID)
		if err != nil {
			return YuanluoboRecordsResult{}, err
		}
		if ok {
			view.Imported = true
			view.GameID = existing.ID
		}
		out.Records = append(out.Records, view)
	}
	return out, nil
}

func (h *Handler) yuanluoboImportRecord(ctx context.Context, token string, params json.RawMessage) (ImportResult, error) {
	var in yuanluoboImportRecordParams
	if err := decodeParams(params, &in); err != nil {
		return ImportResult{}, err
	}
	sessionID := strings.TrimSpace(in.SessionID)
	if sessionID == "" {
		return ImportResult{}, errors.New("sessionId is required")
	}
	if existing, ok, err := h.repo.FindGameBySource(ctx, yuanluoboSourcePlatform, sessionID); err != nil {
		return ImportResult{}, err
	} else if ok {
		return h.openExistingImport(ctx, token, existing)
	}
	sgfText, displayName, err := h.yuanluobo.DetailSGF(ctx, sessionID)
	if IsYuanluoboAuthInvalid(err) {
		_ = h.yuanluobo.ClearAuth(ctx)
	}
	if err != nil {
		return ImportResult{}, err
	}
	return h.importSGFText(ctx, token, sgfText, displayName, store.CreateGameInput{
		SourcePlatform: yuanluoboSourcePlatform,
		SourceID:       sessionID,
	})
}

func yuanluoboRecordView(item YuanluoboRemoteRecord) YuanluoboRecordView {
	title := item.RobotStrength
	if title == "" {
		title = YuanluoboCategoryName(item.GameMode)
	}
	resultData := yuanluoboGameData{WinPieces: item.WinPieces}
	return YuanluoboRecordView{
		SessionID:       item.SessionID,
		GameMode:        item.GameMode,
		Category:        YuanluoboCategoryName(item.GameMode),
		StartDate:       yuanluoboUnixDate(item.StartTime),
		StartTime:       item.StartTime,
		BlackPlayerName: item.BlackPlayerName,
		WhitePlayerName: item.WhitePlayerName,
		Title:           title,
		Result:          formatYuanluoboResult(resultData),
		ResultLabel:     formatYuanluoboResultLabel(resultData),
		ResultWinner:    yuanluoboResultWinner(resultData),
		TotalRound:      item.TotalRound,
	}
}

func (h *Handler) openExistingImport(ctx context.Context, token string, record store.GameRecord) (ImportResult, error) {
	ws, err := h.ensureWorkspaceGame(ctx, token, record.ID)
	if err != nil {
		return ImportResult{}, err
	}
	snapshot, err := ws.SelectGame(record.ID)
	if err != nil {
		return ImportResult{}, err
	}
	return ImportResult{Game: record, Snapshot: snapshot}, nil
}
