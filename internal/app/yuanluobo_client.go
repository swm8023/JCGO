package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

const defaultYuanluoboBaseURL = "https://jupiter.yuanluobo.com"

type YuanluoboQRStatus int

const (
	YuanluoboQRUnscanned YuanluoboQRStatus = 0
	YuanluoboQRScanned   YuanluoboQRStatus = 1
	YuanluoboQRLogined   YuanluoboQRStatus = 2
	YuanluoboQROverdue   YuanluoboQRStatus = 3
	YuanluoboQRLoading   YuanluoboQRStatus = 4
)

type YuanluoboQRCode struct {
	Key     string `json:"key"`
	Image   string `json:"image"`
	ScanURL string `json:"scanUrl"`
}

type YuanluoboLoginPoll struct {
	Status YuanluoboQRStatus `json:"status"`
	Desc   string            `json:"desc"`
	Token  string            `json:"token"`
	UID    string            `json:"uid"`
}

type YuanluoboUser struct {
	ID          int64  `json:"id"`
	PlayerID    string `json:"playerId"`
	Name        string `json:"name"`
	GroupID     string `json:"groupId"`
	UserID      string `json:"userId"`
	AvatarURL   string `json:"avatarUrl"`
	PhoneNumber string `json:"phoneNumber"`
}

type YuanluoboPlayer struct {
	PlayerID  string `json:"playerId"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatarUrl"`
	GroupID   string `json:"groupId"`
}

type YuanluoboRecordListRequest struct {
	Page     int    `json:"page"`
	Size     int    `json:"size"`
	PlayerID string `json:"playerId"`
	GameMode int    `json:"gameMode"`
}

type YuanluoboRecordList struct {
	Total     int                     `json:"total"`
	Page      int                     `json:"page"`
	Size      int                     `json:"size"`
	PageTotal int                     `json:"pageTotal"`
	List      []YuanluoboRemoteRecord `json:"list"`
}

type YuanluoboRemoteRecord struct {
	SessionID       string  `json:"session_id"`
	GameMode        int     `json:"game_mode"`
	GameRule        int     `json:"game_rule"`
	TotalRound      int     `json:"total_round"`
	GridSize        int     `json:"grid_size"`
	PlayMode        int     `json:"play_mode"`
	Status          int     `json:"status"`
	StartTime       int64   `json:"start_time"`
	BlackPlayerName string  `json:"black_player_name"`
	WhitePlayerName string  `json:"white_player_name"`
	RobotStrength   string  `json:"robot_strength_desc"`
	WinPieces       float64 `json:"win_pieces"`
	FinalScore      float64 `json:"final_score"`
	BlackNumber     float64 `json:"black_number"`
	WhiteNumber     float64 `json:"white_number"`
}

type yuanluoboEnvelope[T any] struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Success bool   `json:"success"`
	Data    T      `json:"data"`
}

type YuanluoboAuthInvalidError struct {
	Message string
}

func (e YuanluoboAuthInvalidError) Error() string {
	if e.Message == "" {
		return "yuanluobo auth invalid"
	}
	return e.Message
}

func IsYuanluoboAuthInvalid(err error) bool {
	var target YuanluoboAuthInvalidError
	return errors.As(err, &target)
}

type YuanluoboClient struct {
	baseURL    string
	httpClient *http.Client
}

func NewYuanluoboClient(baseURL string, httpClient *http.Client) *YuanluoboClient {
	if strings.TrimSpace(baseURL) == "" {
		baseURL = defaultYuanluoboBaseURL
	}
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &YuanluoboClient{baseURL: strings.TrimRight(baseURL, "/"), httpClient: httpClient}
}

func (c *YuanluoboClient) LoginStart(ctx context.Context) (YuanluoboQRCode, error) {
	qr, err := getYuanluobo[YuanluoboQRCode](ctx, c, YuanluoboAuth{}, "/sso/permit/v1/qrcode", nil)
	if err != nil {
		return qr, err
	}
	qr.ScanURL = c.loginScanURL(qr.Key)
	return qr, nil
}

func (c *YuanluoboClient) loginScanURL(key string) string {
	query := url.Values{
		"key":  {key},
		"from": {"qrcode-login"},
	}
	return c.baseURL + "/robot-public/all-in-app/scanned-page?" + query.Encode()
}

func (c *YuanluoboClient) LoginPoll(ctx context.Context, key string) (YuanluoboLoginPoll, error) {
	return getYuanluobo[YuanluoboLoginPoll](ctx, c, YuanluoboAuth{}, "/sso/permit/v1/qrcode/poll", url.Values{"key": {key}})
}

func (c *YuanluoboClient) UserInfo(ctx context.Context, auth YuanluoboAuth) (YuanluoboUser, error) {
	return postYuanluobo[YuanluoboUser](ctx, c, auth, "/r2/usercenter/v2/users/me/getOrAdd", map[string]any{})
}

func (c *YuanluoboClient) Players(ctx context.Context, auth YuanluoboAuth, groupID string) ([]YuanluoboPlayer, error) {
	result, err := getYuanluobo[struct {
		List []YuanluoboPlayer `json:"list"`
	}](ctx, c, auth, "/r2/usercenter/v2/players", url.Values{"groupId": {groupID}})
	if err != nil {
		return nil, err
	}
	return result.List, nil
}

func (c *YuanluoboClient) Records(ctx context.Context, auth YuanluoboAuth, in YuanluoboRecordListRequest) (YuanluoboRecordList, error) {
	return postYuanluobo[YuanluoboRecordList](ctx, c, auth, "/r2/chess/wq/sdr/v1/record/list", in)
}

func (c *YuanluoboClient) Detail(ctx context.Context, auth YuanluoboAuth, sessionID string) (yuanluoboGameData, error) {
	return postYuanluobo[yuanluoboGameData](ctx, c, auth, "/r2/chess/wq/sdr/v3/record/detail", map[string]string{"sessionId": sessionID})
}

func (c *YuanluoboClient) Logout(ctx context.Context, auth YuanluoboAuth) error {
	_, err := postYuanluobo[json.RawMessage](ctx, c, auth, "/sso/v1/logout", map[string]any{})
	return err
}

func getYuanluobo[T any](ctx context.Context, c *YuanluoboClient, auth YuanluoboAuth, path string, query url.Values) (T, error) {
	if query != nil && len(query) > 0 {
		path += "?" + query.Encode()
	}
	return doYuanluobo[T](ctx, c, auth, http.MethodGet, path, nil)
}

func postYuanluobo[T any](ctx context.Context, c *YuanluoboClient, auth YuanluoboAuth, path string, body any) (T, error) {
	data, err := json.Marshal(body)
	if err != nil {
		var zero T
		return zero, err
	}
	return doYuanluobo[T](ctx, c, auth, http.MethodPost, path, data)
}

func doYuanluobo[T any](ctx context.Context, c *YuanluoboClient, auth YuanluoboAuth, method, path string, body []byte) (T, error) {
	var zero T
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return zero, err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("SERVER-VERSION", "1.0.1")
	req.Header.Set("SOURCE", "APP")
	req.Header.Set("CLIENT-TYPE", "APP")
	req.Header.Set("AUTH-PRODUCT-NAME", "SenseRobot-Go")
	req.Header.Set("Accept-Language", "zh-CN")
	if auth.Token != "" {
		req.Header.Set("AUTH-TOKEN", auth.Token)
	}
	if auth.UID != "" {
		req.Header.Set("AUTH-USERID", auth.UID)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return zero, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return zero, err
	}
	if resp.StatusCode == http.StatusUnauthorized {
		return zero, YuanluoboAuthInvalidError{Message: extractYuanluoboMessage(raw)}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return zero, fmt.Errorf("yuanluobo http status %d", resp.StatusCode)
	}
	var envelope yuanluoboEnvelope[T]
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return zero, err
	}
	if envelope.Code == 200401 || envelope.Code == 20120 {
		return zero, YuanluoboAuthInvalidError{Message: envelope.Message}
	}
	if envelope.Code != 100000 {
		if envelope.Message == "" {
			envelope.Message = fmt.Sprintf("yuanluobo api code %d", envelope.Code)
		}
		return zero, errors.New(envelope.Message)
	}
	return envelope.Data, nil
}

func extractYuanluoboMessage(raw []byte) string {
	var envelope struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(raw, &envelope); err == nil {
		return envelope.Message
	}
	return ""
}
