package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
)

type YunbisaiServiceBackend interface {
	Status(context.Context) (YunbisaiStatusResult, error)
	LoginStart(context.Context) (YunbisaiLoginStartResult, error)
	LoginPoll(context.Context, string) (YunbisaiLoginPollResult, error)
	LoginSelect(context.Context, string, string) (YunbisaiStatusResult, error)
	Logout(context.Context) error
	MyEvents(context.Context, int) (YunbisaiMyEventsResult, error)
	MyEventDetail(context.Context, string) (YunbisaiMyEventDetail, error)
}

type yunbisaiLoginPollParams struct {
	FlowID string `json:"flowId"`
}

type yunbisaiLoginSelectParams struct {
	FlowID  string `json:"flowId"`
	LoginID string `json:"loginId"`
}

type yunbisaiMyEventsParams struct {
	Page int `json:"page"`
}

type yunbisaiMyEventDetailParams struct {
	OrderID string `json:"orderId"`
}

func (h *Handler) yunbisaiLoginPoll(ctx context.Context, params json.RawMessage) (YunbisaiLoginPollResult, error) {
	var in yunbisaiLoginPollParams
	if err := decodeParams(params, &in); err != nil {
		return YunbisaiLoginPollResult{}, err
	}
	in.FlowID = strings.TrimSpace(in.FlowID)
	if in.FlowID == "" {
		return YunbisaiLoginPollResult{}, errors.New("flowId is required")
	}
	return h.yunbisai.LoginPoll(ctx, in.FlowID)
}

func (h *Handler) yunbisaiLoginSelect(ctx context.Context, params json.RawMessage) (YunbisaiStatusResult, error) {
	var in yunbisaiLoginSelectParams
	if err := decodeParams(params, &in); err != nil {
		return YunbisaiStatusResult{}, err
	}
	in.FlowID = strings.TrimSpace(in.FlowID)
	in.LoginID = strings.TrimSpace(in.LoginID)
	if in.FlowID == "" {
		return YunbisaiStatusResult{}, errors.New("flowId is required")
	}
	if in.LoginID == "" {
		return YunbisaiStatusResult{}, errors.New("loginId is required")
	}
	return h.yunbisai.LoginSelect(ctx, in.FlowID, in.LoginID)
}

func (h *Handler) yunbisaiMyEvents(ctx context.Context, params json.RawMessage) (YunbisaiMyEventsResult, error) {
	var in yunbisaiMyEventsParams
	if err := decodeParams(params, &in); err != nil {
		return YunbisaiMyEventsResult{}, err
	}
	return h.yunbisai.MyEvents(ctx, in.Page)
}

func (h *Handler) yunbisaiMyEventDetail(ctx context.Context, params json.RawMessage) (YunbisaiMyEventDetail, error) {
	var in yunbisaiMyEventDetailParams
	if err := decodeParams(params, &in); err != nil {
		return YunbisaiMyEventDetail{}, err
	}
	in.OrderID = strings.TrimSpace(in.OrderID)
	if in.OrderID == "" {
		return YunbisaiMyEventDetail{}, errors.New("orderId is required")
	}
	return h.yunbisai.MyEventDetail(ctx, in.OrderID)
}
