package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestYuanluoboClientStartsAndPollsQRCodeLogin(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/sso/permit/v1/qrcode", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Fatalf("method = %s", r.Method)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code":    100000,
			"success": true,
			"data": map[string]any{
				"key":   "qr-key",
				"image": "base64-jpeg",
			},
		})
	})
	mux.HandleFunc("/sso/permit/v1/qrcode/poll", func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("key"); got != "qr-key" {
			t.Fatalf("key = %q", got)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code":    100000,
			"success": true,
			"data": map[string]any{
				"status": 2,
				"desc":   "已登录",
				"token":  "token-1",
				"uid":    "uid-1",
			},
		})
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	client := NewYuanluoboClient(server.URL, server.Client())
	qr, err := client.LoginStart(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if qr.Key != "qr-key" || qr.Image != "base64-jpeg" {
		t.Fatalf("qr = %#v", qr)
	}
	poll, err := client.LoginPoll(context.Background(), "qr-key")
	if err != nil {
		t.Fatal(err)
	}
	if poll.Status != YuanluoboQRLogined || poll.Token != "token-1" || poll.UID != "uid-1" {
		t.Fatalf("poll = %#v", poll)
	}
}

func TestYuanluoboClientSendsAuthHeadersForRecords(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/r2/chess/wq/sdr/v1/record/list", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("AUTH-TOKEN") != "token-1" || r.Header.Get("AUTH-USERID") != "uid-1" {
			t.Fatalf("auth headers = %q/%q", r.Header.Get("AUTH-TOKEN"), r.Header.Get("AUTH-USERID"))
		}
		if r.Header.Get("AUTH-PRODUCT-NAME") != "SenseRobot-Go" {
			t.Fatalf("product header = %q", r.Header.Get("AUTH-PRODUCT-NAME"))
		}
		var body YuanluoboRecordListRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Page != 1 || body.Size != 10 || body.PlayerID != "player-1" || body.GameMode != 15 {
			t.Fatalf("body = %#v", body)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code":    100000,
			"success": true,
			"data": map[string]any{
				"total":     1,
				"page":      1,
				"size":      10,
				"pageTotal": 1,
				"list": []map[string]any{{
					"session_id":        "session-1",
					"game_mode":         15,
					"game_rule":         1,
					"total_round":       120,
					"grid_size":         3,
					"play_mode":         1,
					"start_time":        1783500000,
					"black_player_name": "Black",
					"white_player_name": "White",
					"win_pieces":        -3.5,
				}},
			},
		})
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	client := NewYuanluoboClient(server.URL, server.Client())
	records, err := client.Records(context.Background(), YuanluoboAuth{Token: "token-1", UID: "uid-1"}, YuanluoboRecordListRequest{
		Page: 1, Size: 10, PlayerID: "player-1", GameMode: 15,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(records.List) != 1 || records.List[0].SessionID != "session-1" {
		t.Fatalf("records = %#v", records)
	}
}

func TestYuanluoboClientReturnsAuthInvalid(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code":    200401,
			"success": false,
			"message": "用户凭据丢失",
		})
	}))
	defer server.Close()

	client := NewYuanluoboClient(server.URL, server.Client())
	_, err := client.UserInfo(context.Background(), YuanluoboAuth{Token: "bad", UID: "uid"})
	if err == nil || !IsYuanluoboAuthInvalid(err) {
		t.Fatalf("err = %v", err)
	}
}

func TestYuanluoboRecordCategoryName(t *testing.T) {
	cases := map[int]string{
		0:  "全部",
		1:  "元萝卜AI",
		15: "星阵AI",
		2:  "巅峰对决",
		5:  "99围棋",
		6:  "新博围棋",
		7:  "弈客少儿",
		8:  "弈客围棋",
		9:  "佳弈围棋",
		4:  "五子棋",
		3:  "好友约战",
		13: "野狐成人",
		14: "野狐少儿",
		17: "赛事",
	}
	for mode, want := range cases {
		if got := YuanluoboCategoryName(mode); got != want {
			t.Fatalf("mode %d category = %q, want %q", mode, got, want)
		}
	}
	if got := YuanluoboCategoryName(99); got != "其他" {
		t.Fatalf("unknown category = %q", got)
	}
}
