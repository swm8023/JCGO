package worker

import (
	"context"
	"encoding/json"
	"os/exec"
	"runtime"
	"strings"
)

func DetectHardware(ctx context.Context) HardwareInfo {
	if runtime.GOOS != "windows" {
		return HardwareInfo{}
	}
	script := `$cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name)
$gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name })
[pscustomobject]@{ cpu = $cpu; gpus = $gpus } | ConvertTo-Json -Compress`
	out, err := exec.CommandContext(ctx, "powershell.exe", "-NoLogo", "-NoProfile", "-Command", script).Output()
	if err != nil {
		return HardwareInfo{}
	}
	var raw struct {
		CPU  string   `json:"cpu"`
		GPUs []string `json:"gpus"`
	}
	if err := json.Unmarshal(out, &raw); err != nil {
		return HardwareInfo{}
	}
	info := HardwareInfo{CPU: strings.TrimSpace(raw.CPU)}
	for _, gpu := range raw.GPUs {
		gpu = strings.TrimSpace(gpu)
		if gpu != "" {
			info.GPUs = append(info.GPUs, gpu)
		}
	}
	return info
}
