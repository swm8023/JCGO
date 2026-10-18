//go:build windows

package hubregistration

import (
	"context"
	"github.com/tailscale/go-winio"
	"net"
)

func dial(ctx context.Context, endpoint string) (net.Conn, error) {
	return winio.DialPipeContext(ctx, endpoint)
}
