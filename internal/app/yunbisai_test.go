package app

import (
	"context"
	"testing"
)

type fakeYunbisaiClient struct {
	qr             YunbisaiQRCode
	poll           YunbisaiLoginPoll
	selectedAuth   YunbisaiAuth
	orders         YunbisaiOrderPage
	orderDetail    YunbisaiOrderDetail
	eventInfo      map[string]any
	ordersErr      error
	orderDetailErr error
	eventInfoErr   error
	selectedLogin  string
	orderPages     []int
	eventInfoID    string
	eventGroups    []YunbisaiRemoteGroup
	eventGroupsErr error
	eventGroupID   string
	pairingRound   YunbisaiRemotePairingRound
	pairingErr     error
	pairingGroupID string
	pairingBout    int
}

func (f *fakeYunbisaiClient) LoginStart(context.Context) (YunbisaiQRCode, error) {
	return f.qr, nil
}

func (f *fakeYunbisaiClient) LoginPoll(context.Context, string) (YunbisaiLoginPoll, error) {
	return f.poll, nil
}

func (f *fakeYunbisaiClient) LoginSelect(_ context.Context, _ YunbisaiLoginPoll, account YunbisaiAccount) (YunbisaiAuth, error) {
	f.selectedLogin = account.LoginID
	return f.selectedAuth, nil
}

func (f *fakeYunbisaiClient) Orders(_ context.Context, _ YunbisaiAuth, page int) (YunbisaiOrderPage, error) {
	f.orderPages = append(f.orderPages, page)
	return f.orders, f.ordersErr
}

func (f *fakeYunbisaiClient) OrderDetail(context.Context, YunbisaiAuth, string) (YunbisaiOrderDetail, error) {
	return f.orderDetail, f.orderDetailErr
}

func (f *fakeYunbisaiClient) EventInfo(_ context.Context, eventID string) (map[string]any, error) {
	f.eventInfoID = eventID
	return f.eventInfo, f.eventInfoErr
}

func (f *fakeYunbisaiClient) EventGroups(_ context.Context, eventID string) ([]YunbisaiRemoteGroup, error) {
	f.eventGroupID = eventID
	return f.eventGroups, f.eventGroupsErr
}

func (f *fakeYunbisaiClient) GroupPairings(_ context.Context, groupID string, bout int) (YunbisaiRemotePairingRound, error) {
	f.pairingGroupID = groupID
	f.pairingBout = bout
	return f.pairingRound, f.pairingErr
}

func TestYunbisaiServiceUsesOpaqueLoginFlowAndFiltersOrders(t *testing.T) {
	ctx := context.Background()
	store := NewYunbisaiMemoryAuthStore()
	if err := store.Save(ctx, yunbisaiTestAuth("7")); err != nil {
		t.Fatal(err)
	}
	client := &fakeYunbisaiClient{
		qr: YunbisaiQRCode{SceneID: "remote-scene-secret", ImageURL: "https://example.test/qr.png"},
		orders: YunbisaiOrderPage{Total: 8, Rows: []YunbisaiOrder{
			{OrderID: "1", OrderName: "赛事报名", OrderType: "1", State: "1"},
			{OrderID: "2", OrderName: "培训报名", OrderType: "40", State: "2"},
			{OrderID: "3", OrderName: "补报名", OrderType: "3", State: "2"},
			{OrderID: "4", OrderName: "AI 比赛", OrderType: "20", State: "1"},
			{OrderID: "5", OrderName: "综合报名", OrderType: "42", State: "2"},
			{OrderID: "6", OrderName: "商城订单", OrderType: "99", State: "2"},
			{OrderID: "7", OrderName: "已关闭赛事", OrderType: "1", State: "3"},
			{OrderID: "8", OrderName: "已取消赛事", OrderType: "42", State: "0"},
		}},
	}
	service := NewYunbisaiService(YunbisaiServiceOptions{AuthStore: store, Client: client})

	start, err := service.LoginStart(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if start.FlowID == "" || start.FlowID == client.qr.SceneID || start.ImageURL != client.qr.ImageURL {
		t.Fatalf("login start = %#v", start)
	}
	events, err := service.MyEvents(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if !events.LoggedIn || events.Total != 5 || len(events.Events) != 5 {
		t.Fatalf("events = %#v", events)
	}
	if events.Events[0].Status != "pending" || events.Events[1].Status != "paid" {
		t.Fatalf("statuses = %#v", events.Events)
	}
}

func TestYunbisaiServiceAutoSelectsSingleAccount(t *testing.T) {
	ctx := context.Background()
	store := NewYunbisaiMemoryAuthStore()
	account := YunbisaiAccount{LoginID: "7", Name: "棋手甲", Account: "138****0000", LoginType: "3"}
	client := &fakeYunbisaiClient{
		qr:           YunbisaiQRCode{SceneID: "scene-1", ImageURL: "https://example.test/qr.png"},
		poll:         YunbisaiLoginPoll{Status: "accounts", OpenID: "open-secret", SCode: "code-secret", Accounts: []YunbisaiAccount{account}},
		selectedAuth: yunbisaiTestAuth("7"),
	}
	service := NewYunbisaiService(YunbisaiServiceOptions{AuthStore: store, Client: client})
	start, err := service.LoginStart(ctx)
	if err != nil {
		t.Fatal(err)
	}
	poll, err := service.LoginPoll(ctx, start.FlowID)
	if err != nil || poll.Status != "authorized" || len(poll.Accounts) != 0 {
		t.Fatalf("poll = %#v err %v", poll, err)
	}
	if client.selectedLogin != "7" {
		t.Fatalf("selected login = %q", client.selectedLogin)
	}
	if _, ok, err := store.Load(ctx); err != nil || !ok {
		t.Fatalf("saved auth = ok %v err %v", ok, err)
	}
}

func TestYunbisaiServiceRequiresSelectionForMultipleAccounts(t *testing.T) {
	ctx := context.Background()
	store := NewYunbisaiMemoryAuthStore()
	client := &fakeYunbisaiClient{
		qr: YunbisaiQRCode{SceneID: "scene-1", ImageURL: "https://example.test/qr.png"},
		poll: YunbisaiLoginPoll{
			Status: "accounts", OpenID: "open-secret", SCode: "code-secret",
			Accounts: []YunbisaiAccount{
				{LoginID: "7", Name: "棋手甲"},
				{LoginID: "8", Name: "棋手乙"},
			},
		},
		selectedAuth: yunbisaiTestAuth("8"),
	}
	service := NewYunbisaiService(YunbisaiServiceOptions{AuthStore: store, Client: client})
	start, err := service.LoginStart(ctx)
	if err != nil {
		t.Fatal(err)
	}
	poll, err := service.LoginPoll(ctx, start.FlowID)
	if err != nil || poll.Status != "accounts" || len(poll.Accounts) != 2 {
		t.Fatalf("poll = %#v err %v", poll, err)
	}
	status, err := service.LoginSelect(ctx, start.FlowID, "8")
	if err != nil || !status.LoggedIn || status.Account == nil || status.Account.LoginID != "8" {
		t.Fatalf("status = %#v err %v", status, err)
	}
	if client.selectedLogin != "8" {
		t.Fatalf("selected login = %q", client.selectedLogin)
	}
}

func TestYunbisaiServiceMarksExpiredAuthorizationInvalid(t *testing.T) {
	ctx := context.Background()
	store := NewYunbisaiMemoryAuthStore()
	if err := store.Save(ctx, yunbisaiTestAuth("7")); err != nil {
		t.Fatal(err)
	}
	client := &fakeYunbisaiClient{ordersErr: YunbisaiAuthInvalidError{}}
	service := NewYunbisaiService(YunbisaiServiceOptions{AuthStore: store, Client: client})
	result, err := service.MyEvents(ctx, 1)
	if err != nil || result.LoggedIn {
		t.Fatalf("result = %#v err %v", result, err)
	}
	auth, ok, err := store.Load(ctx)
	if err != nil || ok || auth.Token == "" {
		t.Fatalf("auth after expiry = %#v ok %v err %v", auth, ok, err)
	}
	second, err := service.MyEvents(ctx, 1)
	if err != nil || second.LoggedIn || len(client.orderPages) != 1 {
		t.Fatalf("second expired load = %#v calls %v err %v", second, client.orderPages, err)
	}
}

func TestYunbisaiServicePreservesAuthorizationAfterExpiredDetail(t *testing.T) {
	ctx := context.Background()
	store := NewYunbisaiMemoryAuthStore()
	if err := store.Save(ctx, yunbisaiTestAuth("7")); err != nil {
		t.Fatal(err)
	}
	client := &fakeYunbisaiClient{orderDetailErr: YunbisaiAuthInvalidError{}}
	service := NewYunbisaiService(YunbisaiServiceOptions{AuthStore: store, Client: client})
	detail, err := service.MyEventDetail(ctx, "order-1")
	if err != nil || detail.LoggedIn {
		t.Fatalf("detail = %#v err %v", detail, err)
	}
	auth, ok, err := store.Load(ctx)
	if err != nil || ok || auth.Token == "" {
		t.Fatalf("auth after detail expiry = %#v ok %v err %v", auth, ok, err)
	}
}

func TestYunbisaiServiceMapsOrderDetail(t *testing.T) {
	ctx := context.Background()
	store := NewYunbisaiMemoryAuthStore()
	if err := store.Save(ctx, yunbisaiTestAuth("7")); err != nil {
		t.Fatal(err)
	}
	client := &fakeYunbisaiClient{orderDetail: YunbisaiOrderDetail{
		OrderInfo: map[string]any{
			"orderid": "order-1", "event_id": "67043", "state": "2",
			"acost": "128.00", "createtime": "2026-07-01 10:00:00",
		},
		GameInfo: map[string]any{},
		PlayerInfo: map[string]any{
			"groupName": "甲组", "teamName": "杭州队",
			"playerinfo": []any{
				map[string]any{"idcardname": "棋手甲", "groupname": "甲组", "teamname": "杭州队"},
			},
		},
	}, eventInfo: map[string]any{
		"title": "杭州围棋公开赛", "begintime": "2026-08-01 09:00:00",
		"endtime": "2026-08-01 17:00:00", "address": "杭州市上城区", "cname": "杭州棋院",
	}}
	service := NewYunbisaiService(YunbisaiServiceOptions{AuthStore: store, Client: client})
	detail, err := service.MyEventDetail(ctx, "order-1")
	if err != nil {
		t.Fatal(err)
	}
	if !detail.LoggedIn || detail.EventID != "67043" || detail.Status != "paid" {
		t.Fatalf("detail = %#v", detail)
	}
	if detail.OfficialURL != "https://m.yunbisai.com/event/67043" || len(detail.Players) != 1 || detail.Players[0].Name != "棋手甲" {
		t.Fatalf("detail links/players = %#v", detail)
	}
	if detail.StartTime != "2026-08-01 09:00:00" || detail.EndTime != "2026-08-01 17:00:00" || detail.Address != "杭州市上城区" || detail.Organizer != "杭州棋院" {
		t.Fatalf("enriched detail = %#v", detail)
	}
	if client.eventInfoID != "67043" {
		t.Fatalf("event info id = %q", client.eventInfoID)
	}
}

func TestYunbisaiServiceLoadsEventGroupsOnce(t *testing.T) {
	client := &fakeYunbisaiClient{eventGroups: []YunbisaiRemoteGroup{{
		GroupID: "331092", Name: "8级组", PlayerCount: 27,
		StartTime: "2026-06-07 00:00:00", EndTime: "2026-06-07 19:30:00",
	}}}
	service := NewYunbisaiService(YunbisaiServiceOptions{Client: client})

	groups, err := service.EventGroups(context.Background(), "67043")
	if err != nil || len(groups) != 1 {
		t.Fatalf("groups = %#v err %v", groups, err)
	}
	if client.eventGroupID != "67043" {
		t.Fatalf("event group id = %q", client.eventGroupID)
	}
	if groups[0].GroupID != "331092" || groups[0].Name != "8级组" || groups[0].PlayerCount != 27 {
		t.Fatalf("group = %#v", groups[0])
	}
}

func TestYunbisaiServiceMapsGroupPairings(t *testing.T) {
	client := &fakeYunbisaiClient{pairingRound: YunbisaiRemotePairingRound{
		GroupName: "8级组", LastBout: 7, TotalBout: 7,
		Rows: []YunbisaiRemotePairing{
			{
				SeatNumber: "1", P1Name: "棋手甲", P1TeamName: "甲队", P1Result: "1", P1Score: "2.0", P1Integral: "12.0",
				P2Name: "棋手乙", P2TeamName: "乙队", P2Result: "2", P2Score: "0.0", P2Integral: "10.0",
			},
			{SeatNumber: "2", P1Name: "棋手丙", P1Result: "1", P2Name: "--", P2Result: ""},
			{SeatNumber: "3", P1Name: "棋手丁", P1Result: "9", P2Name: "棋手戊", P2Result: "9"},
		},
	}}
	service := NewYunbisaiService(YunbisaiServiceOptions{Client: client})

	result, err := service.GroupPairings(context.Background(), "331092", 0)
	if err != nil {
		t.Fatal(err)
	}
	if client.pairingGroupID != "331092" || client.pairingBout != 0 {
		t.Fatalf("pairing call = %#v", client)
	}
	if result.GroupID != "331092" || result.GroupName != "8级组" || result.Round != 7 || result.TotalRounds != 7 || len(result.Matches) != 3 {
		t.Fatalf("result = %#v", result)
	}
	if result.Matches[0].Player1.Result != "win" || result.Matches[0].Player2.Result != "loss" {
		t.Fatalf("known results = %#v", result.Matches[0])
	}
	if result.Matches[0].Player1.TotalScore != "12.0" || result.Matches[0].Player2.TotalScore != "10.0" || result.Matches[0].Player1.Score != "2.0" {
		t.Fatalf("total scores = %#v", result.Matches[0])
	}
	if result.Matches[1].Player1.TotalScore != "" || result.Matches[1].Player2.TotalScore != "" {
		t.Fatalf("missing total scores = %#v", result.Matches[1])
	}
	if result.Matches[1].Player2.Result != "bye" {
		t.Fatalf("bye result = %#v", result.Matches[1])
	}
	if result.Matches[2].Player1.Result != "unknown" || result.Matches[2].Player2.Result != "unknown" {
		t.Fatalf("unknown results = %#v", result.Matches[2])
	}
}

func TestYunbisaiServiceRejectsInvalidGroupRequests(t *testing.T) {
	client := &fakeYunbisaiClient{}
	service := NewYunbisaiService(YunbisaiServiceOptions{Client: client})
	if _, err := service.EventGroups(context.Background(), " "); err == nil {
		t.Fatal("blank event id should fail")
	}
	if client.eventGroupID != "" {
		t.Fatalf("event groups called for invalid id = %q", client.eventGroupID)
	}
	if _, err := service.GroupPairings(context.Background(), " ", 0); err == nil {
		t.Fatal("blank group id should fail")
	}
	if _, err := service.GroupPairings(context.Background(), "331092", -1); err == nil {
		t.Fatal("negative bout should fail")
	}
	if client.pairingGroupID != "" {
		t.Fatalf("pairings called for invalid request = %#v", client)
	}
}

func TestYunbisaiServiceExpiresUnknownLoginFlow(t *testing.T) {
	ctx := context.Background()
	client := &fakeYunbisaiClient{}
	service := NewYunbisaiService(YunbisaiServiceOptions{Client: client})
	poll, err := service.LoginPoll(ctx, "missing")
	if err != nil || poll.Status != "expired" {
		t.Fatalf("poll = %#v err %v", poll, err)
	}
}

func yunbisaiTestAuth(loginID string) YunbisaiAuth {
	return YunbisaiAuth{
		Token: "token-1",
		Account: YunbisaiAccount{
			LoginID: loginID,
			Name:    "棋手",
		},
	}
}
