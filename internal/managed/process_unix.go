//go:build !windows

package managed

import "os/exec"

func HideWindow(cmd *exec.Cmd) {}
