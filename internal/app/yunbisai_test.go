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
	ordersErr      error
	orderDetailErr error
	selectedLogin  string
	orderPages     []int
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

func TestYunbisaiServiceClearsExpiredAuthorization(t *testing.T) {
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
	if _, ok, err := store.Load(ctx); err != nil || ok {
		t.Fatalf("auth after expiry = ok %v err %v", ok, err)
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
			"orderid": "order-1", "event_id": "67043", "title": "杭州围棋公开赛",
			"state": "2", "event_address": "杭州市上城区", "orgname": "杭州棋院",
			"acost": "128.00", "createtime": "2026-07-01 10:00:00",
		},
		GameInfo: map[string]any{"begintime": "2026-08-01 09:00:00", "endtime": "2026-08-01 17:00:00"},
		PlayerInfo: map[string]any{
			"groupName": "甲组", "teamName": "杭州队",
			"playerinfo": []any{
				map[string]any{"idcardname": "棋手甲", "groupname": "甲组", "teamname": "杭州队"},
			},
		},
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
