//go:build !windows

package hubregistration

import (
	"context"
	"net"
)

func dial(ctx context.Context, endpoint string) (net.Conn, error) {
	return (&net.Dialer{}).DialContext(ctx, "unix", endpoint)
}
