package app

import (
	"context"
	"errors"
	"net/http"
	"time"
)

const yuanluoboSourcePlatform = "yuanluobo"

type YuanluoboBackend interface {
	LoginStart(ctx context.Context) (YuanluoboQRCode, error)
	LoginPoll(ctx context.Context, key string) (YuanluoboLoginPoll, error)
	Status(ctx context.Context) (YuanluoboStatusResult, error)
	Logout(ctx context.Context) error
	Players(ctx context.Context) ([]YuanluoboPlayer, error)
	Records(ctx context.Context, in YuanluoboRecordListRequest) (YuanluoboRecordList, error)
	DetailSGF(ctx context.Context, sessionID string) (sgf string, displayName string, err error)
	ClearAuth(ctx context.Context) error
}

type YuanluoboServiceOptions struct {
	AuthStore  YuanluoboAuthStore
	HTTPClient *http.Client
	BaseURL    string
}

type YuanluoboService struct {
	authStore YuanluoboAuthStore
	client    *YuanluoboClient
}

type YuanluoboStatusResult struct {
	LoggedIn bool           `json:"loggedIn"`
	User     *YuanluoboUser `json:"user,omitempty"`
}

type YuanluoboRecordCategory struct {
	Title    string `json:"title"`
	GameMode int    `json:"gameMode"`
}

var yuanluoboCategories = []YuanluoboRecordCategory{
	{Title: "元萝卜AI", GameMode: 1},
	{Title: "星阵AI", GameMode: 15},
	{Title: "巅峰对决", GameMode: 2},
	{Title: "99围棋", GameMode: 5},
	{Title: "新博围棋", GameMode: 6},
	{Title: "弈客少儿", GameMode: 7},
	{Title: "弈客围棋", GameMode: 8},
	{Title: "佳弈围棋", GameMode: 9},
	{Title: "五子棋", GameMode: 4},
	{Title: "好友约战", GameMode: 3},
	{Title: "野狐成人", GameMode: 13},
	{Title: "野狐少儿", GameMode: 14},
	{Title: "赛事", GameMode: 17},
}

func YuanluoboCategories() []YuanluoboRecordCategory {
	out := make([]YuanluoboRecordCategory, len(yuanluoboCategories))
	copy(out, yuanluoboCategories)
	return out
}

func YuanluoboCategoryName(gameMode int) string {
	for _, category := range yuanluoboCategories {
		if category.GameMode == gameMode {
			return category.Title
		}
	}
	return "其他"
}

func NewYuanluoboService(opts YuanluoboServiceOptions) *YuanluoboService {
	authStore := opts.AuthStore
	if authStore == nil {
		authStore = NewYuanluoboMemoryAuthStore()
	}
	return &YuanluoboService{
		authStore: authStore,
		client:    NewYuanluoboClient(opts.BaseURL, opts.HTTPClient),
	}
}

func (s *YuanluoboService) LoginStart(ctx context.Context) (YuanluoboQRCode, error) {
	return s.client.LoginStart(ctx)
}

func (s *YuanluoboService) LoginPoll(ctx context.Context, key string) (YuanluoboLoginPoll, error) {
	poll, err := s.client.LoginPoll(ctx, key)
	if err != nil {
		return YuanluoboLoginPoll{}, err
	}
	if poll.Status == YuanluoboQRLogined {
		if poll.Token == "" || poll.UID == "" {
			return YuanluoboLoginPoll{}, errors.New("yuanluobo login response missing token or uid")
		}
		if err := s.authStore.Save(ctx, YuanluoboAuth{Token: poll.Token, UID: poll.UID}); err != nil {
			return YuanluoboLoginPoll{}, err
		}
	}
	poll.Token = ""
	return poll, nil
}

func (s *YuanluoboService) Status(ctx context.Context) (YuanluoboStatusResult, error) {
	auth, ok, err := s.authStore.Load(ctx)
	if err != nil || !ok {
		return YuanluoboStatusResult{LoggedIn: false}, err
	}
	user, err := s.client.UserInfo(ctx, auth)
	if IsYuanluoboAuthInvalid(err) {
		_ = s.authStore.Clear(ctx)
		return YuanluoboStatusResult{LoggedIn: false}, nil
	}
	if err != nil {
		return YuanluoboStatusResult{}, err
	}
	return YuanluoboStatusResult{LoggedIn: true, User: &user}, nil
}

func (s *YuanluoboService) Logout(ctx context.Context) error {
	auth, ok, err := s.authStore.Load(ctx)
	if err != nil {
		return err
	}
	if ok {
		if err := s.client.Logout(ctx, auth); err != nil && !IsYuanluoboAuthInvalid(err) {
			return err
		}
	}
	return s.authStore.Clear(ctx)
}

func (s *YuanluoboService) Players(ctx context.Context) ([]YuanluoboPlayer, error) {
	auth, user, err := s.authenticatedUser(ctx)
	if err != nil {
		return nil, err
	}
	return s.client.Players(ctx, auth, user.GroupID)
}

func (s *YuanluoboService) Records(ctx context.Context, in YuanluoboRecordListRequest) (YuanluoboRecordList, error) {
	auth, _, err := s.authenticatedUser(ctx)
	if err != nil {
		return YuanluoboRecordList{}, err
	}
	if in.Page <= 0 {
		in.Page = 1
	}
	in.Size = 10
	return s.client.Records(ctx, auth, in)
}

func (s *YuanluoboService) DetailSGF(ctx context.Context, sessionID string) (string, string, error) {
	auth, _, err := s.authenticatedUser(ctx)
	if err != nil {
		return "", "", err
	}
	data, err := s.client.Detail(ctx, auth, sessionID)
	if IsYuanluoboAuthInvalid(err) {
		_ = s.authStore.Clear(ctx)
	}
	if err != nil {
		return "", "", err
	}
	return convertYuanluoboToSGF(data), yuanluoboDisplayName(data), nil
}

func (s *YuanluoboService) ClearAuth(ctx context.Context) error {
	return s.authStore.Clear(ctx)
}

func (s *YuanluoboService) authenticatedUser(ctx context.Context) (YuanluoboAuth, YuanluoboUser, error) {
	auth, ok, err := s.authStore.Load(ctx)
	if err != nil {
		return YuanluoboAuth{}, YuanluoboUser{}, err
	}
	if !ok {
		return YuanluoboAuth{}, YuanluoboUser{}, YuanluoboAuthInvalidError{Message: "元萝卜未登录"}
	}
	user, err := s.client.UserInfo(ctx, auth)
	if IsYuanluoboAuthInvalid(err) {
		_ = s.authStore.Clear(ctx)
	}
	if err != nil {
		return YuanluoboAuth{}, YuanluoboUser{}, err
	}
	return auth, user, nil
}

func yuanluoboUnixDate(seconds int64) string {
	if seconds <= 0 {
		return ""
	}
	return time.Unix(seconds, 0).UTC().Format("2006-01-02")
}
