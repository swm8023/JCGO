package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	yunbisaiLoginFlowTTL = 10 * time.Minute
	yunbisaiPageSize     = 10
)

var (
	yunbisaiEventOrderTypes = map[string]bool{
		"1": true, "3": true, "20": true, "40": true, "42": true,
	}
	yunbisaiActiveOrderStates = map[string]string{
		"1": "pending",
		"2": "paid",
	}
)

type YunbisaiBackend interface {
	LoginStart(context.Context) (YunbisaiQRCode, error)
	LoginPoll(context.Context, string) (YunbisaiLoginPoll, error)
	LoginSelect(context.Context, YunbisaiLoginPoll, YunbisaiAccount) (YunbisaiAuth, error)
	Orders(context.Context, YunbisaiAuth, int) (YunbisaiOrderPage, error)
	OrderDetail(context.Context, YunbisaiAuth, string) (YunbisaiOrderDetail, error)
	EventInfo(context.Context, string) (map[string]any, error)
}

type YunbisaiServiceOptions struct {
	AuthStore    YunbisaiAuthStore
	Client       YunbisaiBackend
	HTTPClient   *http.Client
	ClientConfig YunbisaiClientOptions
	Now          func() time.Time
}

type YunbisaiService struct {
	authStore YunbisaiAuthStore
	client    YunbisaiBackend
	now       func() time.Time

	flowsMu sync.Mutex
	flows   map[string]yunbisaiLoginFlow
}

type yunbisaiLoginFlow struct {
	sceneID   string
	poll      YunbisaiLoginPoll
	expiresAt time.Time
}

type YunbisaiStatusResult struct {
	LoggedIn bool             `json:"loggedIn"`
	Account  *YunbisaiAccount `json:"account,omitempty"`
}

type YunbisaiLoginStartResult struct {
	FlowID   string `json:"flowId"`
	ImageURL string `json:"imageUrl"`
}

type YunbisaiLoginPollResult struct {
	Status   string            `json:"status"`
	Accounts []YunbisaiAccount `json:"accounts,omitempty"`
}

type YunbisaiMyEvent struct {
	OrderID     string `json:"orderId"`
	EventID     string `json:"eventId,omitempty"`
	Title       string `json:"title"`
	Status      string `json:"status"`
	CreatedAt   string `json:"createdAt"`
	Amount      string `json:"amount"`
	OfficialURL string `json:"officialUrl"`
}

type YunbisaiMyEventsResult struct {
	LoggedIn bool              `json:"loggedIn"`
	Total    int               `json:"total"`
	Page     int               `json:"page"`
	Events   []YunbisaiMyEvent `json:"events"`
}

type YunbisaiMyEventDetail struct {
	LoggedIn    bool             `json:"loggedIn"`
	OrderID     string           `json:"orderId,omitempty"`
	EventID     string           `json:"eventId,omitempty"`
	Title       string           `json:"title,omitempty"`
	Status      string           `json:"status,omitempty"`
	StartTime   string           `json:"startTime,omitempty"`
	EndTime     string           `json:"endTime,omitempty"`
	Address     string           `json:"address,omitempty"`
	Organizer   string           `json:"organizer,omitempty"`
	Amount      string           `json:"amount,omitempty"`
	CreatedAt   string           `json:"createdAt,omitempty"`
	OfficialURL string           `json:"officialUrl,omitempty"`
	Players     []YunbisaiPlayer `json:"players,omitempty"`
}

type YunbisaiPlayer struct {
	Name      string `json:"name"`
	GroupName string `json:"groupName,omitempty"`
	TeamName  string `json:"teamName,omitempty"`
}

func NewYunbisaiService(opts YunbisaiServiceOptions) *YunbisaiService {
	authStore := opts.AuthStore
	if authStore == nil {
		authStore = NewYunbisaiMemoryAuthStore()
	}
	client := opts.Client
	if client == nil {
		config := opts.ClientConfig
		if opts.HTTPClient != nil {
			config.HTTPClient = opts.HTTPClient
		}
		client = NewYunbisaiClient(config)
	}
	now := opts.Now
	if now == nil {
		now = time.Now
	}
	return &YunbisaiService{
		authStore: authStore,
		client:    client,
		now:       now,
		flows:     make(map[string]yunbisaiLoginFlow),
	}
}

func (s *YunbisaiService) Status(ctx context.Context) (YunbisaiStatusResult, error) {
	auth, ok, err := s.authStore.Load(ctx)
	if err != nil || !ok {
		return YunbisaiStatusResult{LoggedIn: false}, err
	}
	account := auth.Account
	return YunbisaiStatusResult{LoggedIn: true, Account: &account}, nil
}

func (s *YunbisaiService) LoginStart(ctx context.Context) (YunbisaiLoginStartResult, error) {
	qr, err := s.client.LoginStart(ctx)
	if err != nil {
		return YunbisaiLoginStartResult{}, err
	}
	flowID, err := newYunbisaiFlowID()
	if err != nil {
		return YunbisaiLoginStartResult{}, err
	}
	s.flowsMu.Lock()
	s.deleteExpiredFlowsLocked()
	s.flows[flowID] = yunbisaiLoginFlow{
		sceneID:   qr.SceneID,
		expiresAt: s.now().Add(yunbisaiLoginFlowTTL),
	}
	s.flowsMu.Unlock()
	return YunbisaiLoginStartResult{FlowID: flowID, ImageURL: qr.ImageURL}, nil
}

func (s *YunbisaiService) LoginPoll(ctx context.Context, flowID string) (YunbisaiLoginPollResult, error) {
	flow, ok := s.loginFlow(flowID)
	if !ok {
		return YunbisaiLoginPollResult{Status: "expired"}, nil
	}
	poll, err := s.client.LoginPoll(ctx, flow.sceneID)
	if err != nil {
		return YunbisaiLoginPollResult{}, err
	}
	if poll.Status == "waiting" {
		return YunbisaiLoginPollResult{Status: "waiting"}, nil
	}
	if poll.Status != "accounts" || len(poll.Accounts) == 0 {
		return YunbisaiLoginPollResult{}, errors.New("云比赛扫码状态数据格式无效")
	}
	s.flowsMu.Lock()
	current, exists := s.flows[flowID]
	if exists {
		current.poll = poll
		s.flows[flowID] = current
	}
	s.flowsMu.Unlock()
	if !exists {
		return YunbisaiLoginPollResult{Status: "expired"}, nil
	}
	if len(poll.Accounts) == 1 {
		if _, err := s.authorize(ctx, flowID, poll, poll.Accounts[0]); err != nil {
			return YunbisaiLoginPollResult{}, err
		}
		return YunbisaiLoginPollResult{Status: "authorized"}, nil
	}
	return YunbisaiLoginPollResult{Status: "accounts", Accounts: sanitizedYunbisaiAccounts(poll.Accounts)}, nil
}

func (s *YunbisaiService) LoginSelect(ctx context.Context, flowID, loginID string) (YunbisaiStatusResult, error) {
	flow, ok := s.loginFlow(flowID)
	if !ok || flow.poll.Status != "accounts" {
		return YunbisaiStatusResult{}, errors.New("云比赛登录二维码已过期")
	}
	for _, account := range flow.poll.Accounts {
		if account.LoginID == strings.TrimSpace(loginID) {
			return s.authorize(ctx, flowID, flow.poll, account)
		}
	}
	return YunbisaiStatusResult{}, errors.New("请选择有效的云比赛账号")
}

func (s *YunbisaiService) Logout(ctx context.Context) error {
	return s.authStore.Clear(ctx)
}

func (s *YunbisaiService) MyEvents(ctx context.Context, page int) (YunbisaiMyEventsResult, error) {
	if page <= 0 {
		page = 1
	}
	auth, ok, err := s.authStore.Load(ctx)
	if err != nil {
		return YunbisaiMyEventsResult{}, err
	}
	if !ok {
		return YunbisaiMyEventsResult{LoggedIn: false, Page: page, Events: []YunbisaiMyEvent{}}, nil
	}
	allOrders, expired, err := s.loadOrders(ctx, auth)
	if err != nil {
		return YunbisaiMyEventsResult{}, err
	}
	if expired {
		return YunbisaiMyEventsResult{LoggedIn: false, Page: page, Events: []YunbisaiMyEvent{}}, nil
	}
	events := make([]YunbisaiMyEvent, 0, len(allOrders))
	for _, order := range allOrders {
		status, active := yunbisaiActiveOrderStates[order.State]
		if !active || !yunbisaiEventOrderTypes[order.OrderType] {
			continue
		}
		events = append(events, YunbisaiMyEvent{
			OrderID: order.OrderID, Title: order.OrderName, Status: status,
			CreatedAt: order.CreatedAt, Amount: order.ReceiptAmount,
		})
	}
	total := len(events)
	start := (page - 1) * yunbisaiPageSize
	if start > total {
		start = total
	}
	end := start + yunbisaiPageSize
	if end > total {
		end = total
	}
	return YunbisaiMyEventsResult{
		LoggedIn: true,
		Total:    total,
		Page:     page,
		Events:   append([]YunbisaiMyEvent(nil), events[start:end]...),
	}, nil
}

func (s *YunbisaiService) MyEventDetail(ctx context.Context, orderID string) (YunbisaiMyEventDetail, error) {
	orderID = strings.TrimSpace(orderID)
	if orderID == "" {
		return YunbisaiMyEventDetail{}, errors.New("云比赛订单编号不能为空")
	}
	auth, ok, err := s.authStore.Load(ctx)
	if err != nil {
		return YunbisaiMyEventDetail{}, err
	}
	if !ok {
		return YunbisaiMyEventDetail{LoggedIn: false}, nil
	}
	remote, err := s.client.OrderDetail(ctx, auth, orderID)
	if IsYunbisaiAuthInvalid(err) {
		_ = s.authStore.Clear(ctx)
		return YunbisaiMyEventDetail{LoggedIn: false}, nil
	}
	if err != nil {
		return YunbisaiMyEventDetail{}, err
	}
	detail := mapYunbisaiEventDetail(orderID, remote)
	if detail.EventID != "" && yunbisaiDetailNeedsEventInfo(detail) {
		if eventInfo, eventErr := s.client.EventInfo(ctx, detail.EventID); eventErr == nil {
			detail = enrichYunbisaiEventDetail(detail, eventInfo)
		}
	}
	return detail, nil
}

func (s *YunbisaiService) authorize(
	ctx context.Context,
	flowID string,
	poll YunbisaiLoginPoll,
	account YunbisaiAccount,
) (YunbisaiStatusResult, error) {
	auth, err := s.client.LoginSelect(ctx, poll, account)
	if err != nil {
		return YunbisaiStatusResult{}, err
	}
	if err := s.authStore.Save(ctx, auth); err != nil {
		return YunbisaiStatusResult{}, err
	}
	s.flowsMu.Lock()
	delete(s.flows, flowID)
	s.flowsMu.Unlock()
	savedAccount := auth.Account
	return YunbisaiStatusResult{LoggedIn: true, Account: &savedAccount}, nil
}

func (s *YunbisaiService) loginFlow(flowID string) (yunbisaiLoginFlow, bool) {
	flowID = strings.TrimSpace(flowID)
	s.flowsMu.Lock()
	defer s.flowsMu.Unlock()
	s.deleteExpiredFlowsLocked()
	flow, ok := s.flows[flowID]
	return flow, ok
}

func (s *YunbisaiService) deleteExpiredFlowsLocked() {
	now := s.now()
	for flowID, flow := range s.flows {
		if !flow.expiresAt.After(now) {
			delete(s.flows, flowID)
		}
	}
}

func (s *YunbisaiService) loadOrders(ctx context.Context, auth YunbisaiAuth) ([]YunbisaiOrder, bool, error) {
	first, err := s.client.Orders(ctx, auth, 1)
	if IsYunbisaiAuthInvalid(err) {
		_ = s.authStore.Clear(ctx)
		return nil, true, nil
	}
	if err != nil {
		return nil, false, err
	}
	orders := append([]YunbisaiOrder(nil), first.Rows...)
	pageCount := (first.Total + yunbisaiPageSize - 1) / yunbisaiPageSize
	for page := 2; page <= pageCount; page++ {
		next, err := s.client.Orders(ctx, auth, page)
		if IsYunbisaiAuthInvalid(err) {
			_ = s.authStore.Clear(ctx)
			return nil, true, nil
		}
		if err != nil {
			return nil, false, err
		}
		orders = append(orders, next.Rows...)
	}
	return orders, false, nil
}

func mapYunbisaiEventDetail(orderID string, remote YunbisaiOrderDetail) YunbisaiMyEventDetail {
	orderInfo := remote.OrderInfo
	gameInfo := remote.GameInfo
	playerInfo := remote.PlayerInfo
	eventID := firstYunbisaiText(orderInfo, "event_id", "eventId")
	detail := YunbisaiMyEventDetail{
		LoggedIn:  true,
		OrderID:   firstNonEmpty(firstYunbisaiText(orderInfo, "orderid", "orderId"), orderID),
		EventID:   eventID,
		Title:     firstYunbisaiText(orderInfo, "title", "ordername"),
		Status:    yunbisaiActiveOrderStates[firstYunbisaiText(orderInfo, "state")],
		StartTime: firstYunbisaiText(gameInfo, "begintime", "starttime"),
		EndTime:   firstYunbisaiText(gameInfo, "endtime"),
		Address: firstYunbisaiText(
			orderInfo,
			"event_address",
			"address",
			"room_name",
		),
		Organizer: firstYunbisaiText(orderInfo, "orgname", "seller_name", "loginname"),
		Amount:    firstYunbisaiText(orderInfo, "acost", "cost", "eventcost", "receipt_amount", "total_amount"),
		CreatedAt: firstYunbisaiText(orderInfo, "createtime"),
		Players:   mapYunbisaiPlayers(playerInfo),
	}
	if eventID != "" {
		detail.OfficialURL = "https://m.yunbisai.com/event/" + eventID
	}
	return detail
}

func yunbisaiDetailNeedsEventInfo(detail YunbisaiMyEventDetail) bool {
	return detail.Title == "" ||
		detail.StartTime == "" ||
		detail.EndTime == "" ||
		detail.Address == "" ||
		detail.Organizer == ""
}

func enrichYunbisaiEventDetail(detail YunbisaiMyEventDetail, eventInfo map[string]any) YunbisaiMyEventDetail {
	detail.Title = firstNonEmpty(detail.Title, firstYunbisaiText(eventInfo, "title"))
	detail.StartTime = firstNonEmpty(detail.StartTime, firstYunbisaiText(eventInfo, "begintime"))
	detail.EndTime = firstNonEmpty(detail.EndTime, firstYunbisaiText(eventInfo, "endtime"))
	detail.Address = firstNonEmpty(
		detail.Address,
		firstYunbisaiText(eventInfo, "address"),
		yunbisaiJoinedAddress(eventInfo),
	)
	detail.Organizer = firstNonEmpty(
		detail.Organizer,
		firstYunbisaiText(eventInfo, "cname", "orgname"),
	)
	return detail
}

func yunbisaiJoinedAddress(eventInfo map[string]any) string {
	return strings.TrimSpace(strings.Join([]string{
		firstYunbisaiText(eventInfo, "province_name"),
		firstYunbisaiText(eventInfo, "city_name"),
		firstYunbisaiText(eventInfo, "county_name"),
	}, ""))
}

func mapYunbisaiPlayers(playerInfo map[string]any) []YunbisaiPlayer {
	defaultGroup := firstYunbisaiText(playerInfo, "groupName", "groupname")
	defaultTeam := firstYunbisaiText(playerInfo, "teamName", "teamname")
	rawPlayers, ok := playerInfo["playerinfo"].([]any)
	if !ok {
		return nil
	}
	players := make([]YunbisaiPlayer, 0, len(rawPlayers))
	for _, raw := range rawPlayers {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		name := firstYunbisaiText(item, "idcardname", "card_name", "name")
		if name == "" {
			continue
		}
		players = append(players, YunbisaiPlayer{
			Name:      name,
			GroupName: firstNonEmpty(firstYunbisaiText(item, "groupname", "groupName"), defaultGroup),
			TeamName:  firstNonEmpty(firstYunbisaiText(item, "teamname", "teamName"), defaultTeam),
		})
	}
	return players
}

func firstYunbisaiText(values map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := textValue(values[key]); value != "" {
			return value
		}
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func sanitizedYunbisaiAccounts(accounts []YunbisaiAccount) []YunbisaiAccount {
	out := make([]YunbisaiAccount, len(accounts))
	for i, account := range accounts {
		out[i] = YunbisaiAccount{
			LoginID:  account.LoginID,
			Name:     account.Name,
			Account:  account.Account,
			ImageURL: account.ImageURL,
		}
	}
	return out
}

func newYunbisaiFlowID() (string, error) {
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}
