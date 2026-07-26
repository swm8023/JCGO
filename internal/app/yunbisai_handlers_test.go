package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

type fakeYunbisaiServiceBackend struct {
	polledFlow    string
	selectedFlow  string
	selectedLogin string
	eventsPage    int
	detailOrder   string
	loggedOut     bool
}

func (f *fakeYunbisaiServiceBackend) Status(context.Context) (YunbisaiStatusResult, error) {
	return YunbisaiStatusResult{
		LoggedIn: true,
		Account:  &YunbisaiAccount{LoginID: "7", Name: "棋手甲", Account: "138****0000"},
	}, nil
}

func (f *fakeYunbisaiServiceBackend) LoginStart(context.Context) (YunbisaiLoginStartResult, error) {
	return YunbisaiLoginStartResult{FlowID: "flow-1", ImageURL: "https://example.test/qr.png"}, nil
}

func (f *fakeYunbisaiServiceBackend) LoginPoll(_ context.Context, flowID string) (YunbisaiLoginPollResult, error) {
	f.polledFlow = flowID
	return YunbisaiLoginPollResult{
		Status:   "accounts",
		Accounts: []YunbisaiAccount{{LoginID: "7", Name: "棋手甲"}},
	}, nil
}

func (f *fakeYunbisaiServiceBackend) LoginSelect(_ context.Context, flowID, loginID string) (YunbisaiStatusResult, error) {
	f.selectedFlow = flowID
	f.selectedLogin = loginID
	return YunbisaiStatusResult{
		LoggedIn: true,
		Account:  &YunbisaiAccount{LoginID: loginID, Name: "棋手甲"},
	}, nil
}

func (f *fakeYunbisaiServiceBackend) Logout(context.Context) error {
	f.loggedOut = true
	return nil
}

func (f *fakeYunbisaiServiceBackend) MyEvents(_ context.Context, page int) (YunbisaiMyEventsResult, error) {
	f.eventsPage = page
	return YunbisaiMyEventsResult{
		LoggedIn: true,
		Total:    1,
		Page:     page,
		Events: []YunbisaiMyEvent{{
			OrderID: "order-1", Title: "杭州围棋公开赛", Status: "paid",
		}},
	}, nil
}

func (f *fakeYunbisaiServiceBackend) MyEventDetail(_ context.Context, orderID string) (YunbisaiMyEventDetail, error) {
	f.detailOrder = orderID
	return YunbisaiMyEventDetail{
		LoggedIn: true, OrderID: orderID, EventID: "67043", Title: "杭州围棋公开赛",
		OfficialURL: "https://m.yunbisai.com/event/67043",
	}, nil
}

func TestHandlerCallYunbisaiMethods(t *testing.T) {
	handler, token := newTestHandler(t)
	fake := &fakeYunbisaiServiceBackend{}
	handler.yunbisai = fake

	results := []any{
		callResult[YunbisaiStatusResult](t, handler, token, "yunbisai.status", nil),
		callResult[YunbisaiLoginStartResult](t, handler, token, "yunbisai.loginStart", nil),
		callResult[YunbisaiLoginPollResult](t, handler, token, "yunbisai.loginPoll", map[string]any{"flowId": "flow-1"}),
		callResult[YunbisaiStatusResult](t, handler, token, "yunbisai.loginSelect", map[string]any{"flowId": "flow-1", "loginId": "7"}),
		callResult[any](t, handler, token, "yunbisai.logout", nil),
		callResult[YunbisaiMyEventsResult](t, handler, token, "yunbisai.myEvents", map[string]any{"page": 2}),
		callResult[YunbisaiMyEventDetail](t, handler, token, "yunbisai.myEventDetail", map[string]any{"orderId": "order-1"}),
	}

	if fake.polledFlow != "flow-1" || fake.selectedFlow != "flow-1" || fake.selectedLogin != "7" {
		t.Fatalf("login calls = %#v", fake)
	}
	if !fake.loggedOut || fake.eventsPage != 2 || fake.detailOrder != "order-1" {
		t.Fatalf("data calls = %#v", fake)
	}
	for _, result := range results {
		raw, err := json.Marshal(result)
		if err != nil {
			t.Fatal(err)
		}
		payload := string(raw)
		for _, secretField := range []string{`"token"`, `"cookie"`, `"openId"`, `"sCode"`, `"sceneId"`, `"key"`} {
			if strings.Contains(payload, secretField) {
				t.Fatalf("result contains secret field %s: %s", secretField, payload)
			}
		}
	}
}

func TestYunbisaiHandlerValidatesParameters(t *testing.T) {
	handler, token := newTestHandler(t)
	handler.yunbisai = &fakeYunbisaiServiceBackend{}
	cases := []struct {
		method string
		params map[string]any
	}{
		{method: "yunbisai.loginPoll", params: map[string]any{"flowId": " "}},
		{method: "yunbisai.loginSelect", params: map[string]any{"flowId": "", "loginId": "7"}},
		{method: "yunbisai.loginSelect", params: map[string]any{"flowId": "flow-1", "loginId": ""}},
		{method: "yunbisai.myEventDetail", params: map[string]any{"orderId": " "}},
	}
	for _, tc := range cases {
		raw, err := json.Marshal(tc.params)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := handler.Call(context.Background(), token, tc.method, raw); err == nil {
			t.Fatalf("%s should reject %#v", tc.method, tc.params)
		}
	}
}
