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
	"strconv"
	"strings"
)

const (
	defaultYunbisaiDataCenterURL = "https://data-center.yunbisai.com"
	defaultYunbisaiOpenURL       = "https://open.yunbisai.com"
	defaultYunbisaiAPIURL        = "https://api.yunbisai.com"
	defaultYunbisaiWWWURL        = "https://www.yunbisai.com"
)

type YunbisaiClientOptions struct {
	HTTPClient    *http.Client
	DataCenterURL string
	OpenURL       string
	APIURL        string
	WWWURL        string
}

type YunbisaiClient struct {
	httpClient    *http.Client
	dataCenterURL string
	openURL       string
	apiURL        string
	wwwURL        string
}

type YunbisaiQRCode struct {
	SceneID  string `json:"-"`
	ImageURL string `json:"imageUrl"`
}

type YunbisaiLoginPoll struct {
	Status   string
	OpenID   string
	SCode    string
	Accounts []YunbisaiAccount
}

type YunbisaiOrder struct {
	OrderID       string
	OrderName     string
	OrderType     string
	State         string
	CreatedAt     string
	ReceiptAmount string
}

type YunbisaiOrderPage struct {
	Total int
	Rows  []YunbisaiOrder
}

type YunbisaiOrderDetail struct {
	OrderInfo  map[string]any
	GameInfo   map[string]any
	PlayerInfo map[string]any
}

type YunbisaiAuthInvalidError struct {
	Message string
}

func (e YunbisaiAuthInvalidError) Error() string {
	if e.Message == "" {
		return "云比赛登录已过期"
	}
	return e.Message
}

func IsYunbisaiAuthInvalid(err error) bool {
	var target YunbisaiAuthInvalidError
	return errors.As(err, &target)
}

func NewYunbisaiClient(opts YunbisaiClientOptions) *YunbisaiClient {
	client := opts.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	return &YunbisaiClient{
		httpClient:    client,
		dataCenterURL: baseURL(opts.DataCenterURL, defaultYunbisaiDataCenterURL),
		openURL:       baseURL(opts.OpenURL, defaultYunbisaiOpenURL),
		apiURL:        baseURL(opts.APIURL, defaultYunbisaiAPIURL),
		wwwURL:        baseURL(opts.WWWURL, defaultYunbisaiWWWURL),
	}
}

func (c *YunbisaiClient) LoginStart(ctx context.Context) (YunbisaiQRCode, error) {
	raw, _, err := c.request(ctx, http.MethodGet, c.dataCenterURL+"/api/wechat/loginQRCode", nil, YunbisaiAuth{})
	if err != nil {
		return YunbisaiQRCode{}, err
	}
	var payload struct {
		Error int `json:"error"`
		Data  struct {
			ImageURL string `json:"qrcode_src"`
			SceneID  string `json:"scene_id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return YunbisaiQRCode{}, errors.New("云比赛二维码数据格式无效")
	}
	if payload.Error != 0 || payload.Data.ImageURL == "" || payload.Data.SceneID == "" {
		return YunbisaiQRCode{}, errors.New("云比赛二维码数据格式无效")
	}
	return YunbisaiQRCode{SceneID: payload.Data.SceneID, ImageURL: payload.Data.ImageURL}, nil
}

func (c *YunbisaiClient) LoginPoll(ctx context.Context, sceneID string) (YunbisaiLoginPoll, error) {
	raw, _, err := c.request(ctx, http.MethodGet, c.dataCenterURL+"/api/wechat/login/polling/"+url.PathEscape(sceneID), nil, YunbisaiAuth{})
	if err != nil {
		return YunbisaiLoginPoll{}, err
	}
	var payload struct {
		Error int             `json:"error"`
		Msg   string          `json:"msg"`
		Data  json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil || payload.Error != 0 {
		return YunbisaiLoginPoll{}, errors.New("云比赛扫码状态数据格式无效")
	}
	if payload.Msg == "waiting" {
		return YunbisaiLoginPoll{Status: "waiting"}, nil
	}
	var data struct {
		OpenID   string `json:"open_id"`
		SCode    string `json:"s_code"`
		Accounts []struct {
			LoginID   any    `json:"login_id"`
			LoginType any    `json:"login_type"`
			Name      string `json:"name"`
			Account   string `json:"account"`
			ImageURL  string `json:"login_img"`
		} `json:"user_list"`
	}
	if err := json.Unmarshal(payload.Data, &data); err != nil || data.OpenID == "" || data.SCode == "" || len(data.Accounts) == 0 {
		return YunbisaiLoginPoll{}, errors.New("云比赛扫码状态数据格式无效")
	}
	result := YunbisaiLoginPoll{Status: "accounts", OpenID: data.OpenID, SCode: data.SCode}
	for _, item := range data.Accounts {
		loginID := textValue(item.LoginID)
		if loginID == "" {
			return YunbisaiLoginPoll{}, errors.New("云比赛账号数据格式无效")
		}
		imageURL := item.ImageURL
		if strings.HasPrefix(imageURL, "/") {
			imageURL = "https://g.yunbisai.com" + imageURL
		}
		result.Accounts = append(result.Accounts, YunbisaiAccount{
			LoginID: loginID, LoginType: textValue(item.LoginType), Name: item.Name,
			Account: item.Account, ImageURL: imageURL,
		})
	}
	return result, nil
}

func (c *YunbisaiClient) LoginSelect(ctx context.Context, poll YunbisaiLoginPoll, account YunbisaiAccount) (YunbisaiAuth, error) {
	form := url.Values{
		"login_id": {account.LoginID},
		"open_id":  {poll.OpenID},
		"s_code":   {poll.SCode},
	}
	raw, cookies, err := c.request(ctx, http.MethodPost, c.dataCenterURL+"/api/wechat/login/select-login-user", form, YunbisaiAuth{})
	if err != nil {
		return YunbisaiAuth{}, err
	}
	var payload struct {
		Error int    `json:"error"`
		Msg   string `json:"msg"`
		Data  struct {
			Key   string `json:"key"`
			Token string `json:"token"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil || payload.Error != 0 || payload.Data.Key == "" {
		return YunbisaiAuth{}, errors.New("云比赛账号授权失败")
	}
	auth := YunbisaiAuth{Token: payload.Data.Token, LoginType: account.LoginType, Account: account, Cookies: cookies}
	sessionURL := c.apiURL + "/request/Login/createSession?key=" + url.QueryEscape(payload.Data.Key)
	_, nextCookies, err := c.request(ctx, http.MethodGet, sessionURL, nil, auth)
	if err != nil {
		return YunbisaiAuth{}, err
	}
	auth.Cookies = mergeYunbisaiCookies(auth.Cookies, nextCookies)
	if auth.Token == "" {
		for _, cookie := range auth.Cookies {
			if cookie.Name == "token" {
				auth.Token = cookie.Value
				break
			}
		}
	}
	if !validYunbisaiAuth(auth) {
		return YunbisaiAuth{}, errors.New("云比赛授权响应缺少登录凭证")
	}
	return auth, nil
}

func (c *YunbisaiClient) Orders(ctx context.Context, auth YunbisaiAuth, page int) (YunbisaiOrderPage, error) {
	if page <= 0 {
		page = 1
	}
	query := url.Values{
		"months": {"0"}, "state": {""}, "type": {""},
		"page": {strconv.Itoa(page)}, "pageSize": {"10"},
	}
	raw, _, err := c.request(ctx, http.MethodGet, c.openURL+"/api/order/list?"+query.Encode(), nil, auth)
	if err != nil {
		return YunbisaiOrderPage{}, err
	}
	var payload struct {
		Error int    `json:"error"`
		Msg   string `json:"msg"`
		Data  struct {
			Total int              `json:"total"`
			Rows  []map[string]any `json:"rows"`
		} `json:"datArr"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return YunbisaiOrderPage{}, errors.New("云比赛订单数据格式无效")
	}
	if payload.Error == 255 {
		return YunbisaiOrderPage{}, YunbisaiAuthInvalidError{Message: payload.Msg}
	}
	if payload.Error != 0 {
		return YunbisaiOrderPage{}, errors.New("云比赛订单请求失败")
	}
	result := YunbisaiOrderPage{Total: payload.Data.Total}
	for _, row := range payload.Data.Rows {
		order := YunbisaiOrder{
			OrderID: textValue(row["orderid"]), OrderName: textValue(row["ordername"]),
			OrderType: textValue(row["ordertype"]), State: textValue(row["state"]),
			CreatedAt: textValue(row["createtime"]), ReceiptAmount: textValue(row["receipt_amount"]),
		}
		if order.OrderID == "" || order.OrderName == "" {
			return YunbisaiOrderPage{}, errors.New("云比赛订单数据格式无效")
		}
		result.Rows = append(result.Rows, order)
	}
	return result, nil
}

func (c *YunbisaiClient) OrderDetail(ctx context.Context, auth YunbisaiAuth, orderID string) (YunbisaiOrderDetail, error) {
	form := url.Values{"orderID": {orderID}, "act": {"orderdetail"}}
	raw, _, err := c.request(ctx, http.MethodPost, c.wwwURL+"/request/index/index", form, auth)
	if err != nil {
		return YunbisaiOrderDetail{}, err
	}
	var payload struct {
		Error int    `json:"error"`
		Msg   string `json:"msg"`
		Data  struct {
			OrderInfo  map[string]any `json:"orderInfo"`
			GameInfo   map[string]any `json:"GameInfo"`
			PlayerInfo map[string]any `json:"PlayerInfo"`
		} `json:"datArr"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return YunbisaiOrderDetail{}, errors.New("云比赛订单详情数据格式无效")
	}
	if payload.Error == 255 {
		return YunbisaiOrderDetail{}, YunbisaiAuthInvalidError{Message: payload.Msg}
	}
	if payload.Error != 0 || payload.Data.OrderInfo == nil {
		return YunbisaiOrderDetail{}, errors.New("云比赛订单详情数据格式无效")
	}
	return YunbisaiOrderDetail(payload.Data), nil
}

func (c *YunbisaiClient) request(ctx context.Context, method, endpoint string, form url.Values, auth YunbisaiAuth) ([]byte, []YunbisaiCookie, error) {
	var body io.Reader
	if form != nil {
		body = bytes.NewBufferString(form.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Accept", "application/json")
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	if auth.Token != "" {
		req.Header.Set("token", auth.Token)
		req.Header.Set("Origin", "https://m.yunbisai.com")
	}
	for _, cookie := range auth.Cookies {
		if cookie.Name != "" && cookie.Value != "" {
			req.AddCookie(&http.Cookie{Name: cookie.Name, Value: cookie.Value})
		}
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, nil, err
	}
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return nil, nil, YunbisaiAuthInvalidError{}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, nil, fmt.Errorf("云比赛请求失败（%d）", resp.StatusCode)
	}
	cookies := make([]YunbisaiCookie, 0, len(resp.Cookies()))
	for _, item := range resp.Cookies() {
		domain := item.Domain
		if domain == "" {
			domain = req.URL.Hostname()
		}
		path := item.Path
		if path == "" {
			path = "/"
		}
		cookie := YunbisaiCookie{Name: item.Name, Value: item.Value, Domain: domain, Path: path}
		if !item.Expires.IsZero() {
			cookie.Expires = item.Expires.Unix()
		}
		cookies = append(cookies, cookie)
	}
	return raw, cookies, nil
}

func mergeYunbisaiCookies(current, next []YunbisaiCookie) []YunbisaiCookie {
	out := append([]YunbisaiCookie(nil), current...)
	for _, cookie := range next {
		replaced := false
		for i := range out {
			if out[i].Name == cookie.Name && out[i].Domain == cookie.Domain && out[i].Path == cookie.Path {
				out[i] = cookie
				replaced = true
				break
			}
		}
		if !replaced {
			out = append(out, cookie)
		}
	}
	return out
}

func baseURL(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		value = fallback
	}
	return strings.TrimRight(value, "/")
}

func textValue(value any) string {
	switch item := value.(type) {
	case string:
		return strings.TrimSpace(item)
	case json.Number:
		return item.String()
	case float64:
		return strconv.FormatFloat(item, 'f', -1, 64)
	case int:
		return strconv.Itoa(item)
	default:
		return ""
	}
}
