package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestYunbisaiClientLoginOrdersAndDetail(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/wechat/loginQRCode", func(w http.ResponseWriter, r *http.Request) {
		writeYunbisaiTestJSON(w, map[string]any{
			"error": 0,
			"data":  map[string]any{"qrcode_src": "https://example.test/qr.png", "scene_id": "scene-1"},
		})
	})
	mux.HandleFunc("/api/wechat/login/polling/scene-1", func(w http.ResponseWriter, r *http.Request) {
		writeYunbisaiTestJSON(w, map[string]any{
			"error": 0,
			"msg":   "success",
			"data": map[string]any{
				"open_id": "open-1",
				"s_code":  "code-1",
				"user_list": []map[string]any{{
					"login_id": "7", "login_type": "3", "name": "棋手甲",
					"account": "138****0000", "login_img": "/avatar.png",
				}},
			},
		})
	})
	mux.HandleFunc("/api/wechat/login/select-login-user", func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		if r.Form.Get("login_id") != "7" || r.Form.Get("open_id") != "open-1" || r.Form.Get("s_code") != "code-1" {
			t.Fatalf("select form = %#v", r.Form)
		}
		http.SetCookie(w, &http.Cookie{Name: "token", Value: "token-1", Domain: "127.0.0.1", Path: "/"})
		writeYunbisaiTestJSON(w, map[string]any{"error": 0, "data": map[string]any{"key": "session-key"}})
	})
	mux.HandleFunc("/request/Login/createSession", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("key") != "session-key" {
			t.Fatalf("session key = %q", r.URL.Query().Get("key"))
		}
		http.SetCookie(w, &http.Cookie{Name: "sid", Value: "sid-1", Path: "/"})
		writeYunbisaiTestJSON(w, map[string]any{"error": 0})
	})
	mux.HandleFunc("/api/order/list", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("token") != "token-1" {
			t.Fatalf("token header = %q", r.Header.Get("token"))
		}
		if r.Header.Get("Origin") != "https://m.yunbisai.com" {
			t.Fatalf("origin header = %q", r.Header.Get("Origin"))
		}
		if authorization := r.Header.Get("Authorization"); authorization != "" {
			t.Fatalf("authorization header should be omitted, got %q", authorization)
		}
		if r.URL.Query().Get("page") != "2" || r.URL.Query().Get("pageSize") != "10" {
			t.Fatalf("order query = %q", r.URL.RawQuery)
		}
		writeYunbisaiTestJSON(w, map[string]any{
			"error": 0,
			"datArr": map[string]any{
				"total": 1,
				"rows": []map[string]any{{
					"orderid": "order-1", "ordername": "杭州围棋公开赛", "ordertype": "1",
					"state": "2", "createtime": "2026-07-01 10:00:00", "receipt_amount": "128.00",
				}},
			},
		})
	})
	mux.HandleFunc("/request/index/index", func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		if r.Form.Get("act") != "orderdetail" || r.Form.Get("orderID") != "order-1" {
			t.Fatalf("detail form = %#v", r.Form)
		}
		writeYunbisaiTestJSON(w, map[string]any{
			"error": 0,
			"datArr": map[string]any{
				"orderInfo":  map[string]any{"orderid": "order-1", "event_id": "67043"},
				"GameInfo":   map[string]any{"begintime": "2026-08-01 09:00:00"},
				"PlayerInfo": map[string]any{"playerinfo": []map[string]any{{"idcardname": "棋手甲"}}},
			},
		})
	})
	mux.HandleFunc("/request/Event/Eventdetail", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("eventid") != "67043" {
			t.Fatalf("event id = %q", r.URL.Query().Get("eventid"))
		}
		if r.Header.Get("token") != "" || r.Header.Get("Cookie") != "" {
			t.Fatalf("public event detail should not receive saved credentials")
		}
		writeYunbisaiTestJSON(w, map[string]any{
			"error": 0,
			"datArr": map[string]any{
				"eventresult": map[string]any{
					"title": "杭州围棋公开赛", "begintime": "2026-08-01 09:00:00",
					"endtime": "2026-08-01 17:00:00", "address": "杭州市上城区",
				},
			},
		})
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	client := NewYunbisaiClient(YunbisaiClientOptions{
		HTTPClient:    server.Client(),
		DataCenterURL: server.URL,
		OpenURL:       server.URL,
		APIURL:        server.URL,
		WWWURL:        server.URL,
	})
	ctx := context.Background()
	qr, err := client.LoginStart(ctx)
	if err != nil || qr.SceneID != "scene-1" || qr.ImageURL != "https://example.test/qr.png" {
		t.Fatalf("qr = %#v err %v", qr, err)
	}
	poll, err := client.LoginPoll(ctx, qr.SceneID)
	if err != nil || poll.Status != "accounts" || len(poll.Accounts) != 1 {
		t.Fatalf("poll = %#v err %v", poll, err)
	}
	auth, err := client.LoginSelect(ctx, poll, poll.Accounts[0])
	if err != nil || auth.Token != "token-1" || len(auth.Cookies) < 2 {
		t.Fatalf("auth token present = %v cookies = %d err %v", auth.Token != "", len(auth.Cookies), err)
	}
	orders, err := client.Orders(ctx, auth, 2)
	if err != nil || orders.Total != 1 || orders.Rows[0].OrderID != "order-1" {
		t.Fatalf("orders = %#v err %v", orders, err)
	}
	detail, err := client.OrderDetail(ctx, auth, "order-1")
	if err != nil || detail.OrderInfo["event_id"] != "67043" {
		t.Fatalf("detail = %#v err %v", detail, err)
	}
	eventInfo, err := client.EventInfo(ctx, "67043")
	if err != nil || eventInfo["begintime"] != "2026-08-01 09:00:00" {
		t.Fatalf("event info = %#v err %v", eventInfo, err)
	}
}

func TestYunbisaiClientReturnsWaitingAndAuthInvalid(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/wechat/login/polling/scene-1", func(w http.ResponseWriter, r *http.Request) {
		writeYunbisaiTestJSON(w, map[string]any{"error": 0, "msg": "waiting"})
	})
	mux.HandleFunc("/api/order/list", func(w http.ResponseWriter, r *http.Request) {
		writeYunbisaiTestJSON(w, map[string]any{"error": 255, "msg": "登录已过期"})
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	client := NewYunbisaiClient(YunbisaiClientOptions{
		HTTPClient: server.Client(), DataCenterURL: server.URL, OpenURL: server.URL,
	})
	poll, err := client.LoginPoll(context.Background(), "scene-1")
	if err != nil || poll.Status != "waiting" {
		t.Fatalf("poll = %#v err %v", poll, err)
	}
	_, err = client.Orders(context.Background(), YunbisaiAuth{
		Token: "secret-token", Account: YunbisaiAccount{LoginID: "7"},
	}, 1)
	if err == nil || !IsYunbisaiAuthInvalid(err) {
		t.Fatalf("err = %v", err)
	}
	if errors.Is(err, context.Canceled) || err.Error() == "secret-token" {
		t.Fatalf("unsafe error = %v", err)
	}
}

func TestYunbisaiClientRejectsMalformedPayload(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"error":0,"data":{}}`))
	}))
	defer server.Close()
	client := NewYunbisaiClient(YunbisaiClientOptions{HTTPClient: server.Client(), DataCenterURL: server.URL})
	if _, err := client.LoginStart(context.Background()); err == nil {
		t.Fatal("malformed QR payload should fail")
	}
}

func writeYunbisaiTestJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}
