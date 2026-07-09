@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "& { param([string]$bat, [string]$repo, [Parameter(ValueFromRemainingArguments=$true)][string[]]$deployArgs) $lines = Get-Content -LiteralPath $bat; $idx = [Array]::IndexOf($lines, '# POWERSHELL'); if ($idx -lt 0) { throw 'deploy.bat payload marker missing' }; $script = ($lines[($idx + 1)..($lines.Count - 1)] -join [Environment]::NewLine); & ([ScriptBlock]::Create($script)) -RepoRoot $repo -Mode deploy -LogName 'deploy.bat.log' -DeployArgs $deployArgs }" "%~f0" "%~dp0." %*
exit /b %ERRORLEVEL%
# POWERSHELL
param(
  [Parameter(Mandatory = $true)]
  [string]$RepoRoot,
  [Parameter(Mandatory = $true)]
  [string]$Mode,
  [Parameter(Mandatory = $true)]
  [string]$LogName,
  [string[]]$DeployArgs = @()
)

$ErrorActionPreference = "Stop"

function Wait-ForExit {
  if ($env:JCGO_DEPLOY_NO_PAUSE) {
    return
  }
  Write-Host
  Read-Host "Press Enter to close" | Out-Null
}

function Write-Info {
  param([Parameter(Mandatory = $true)][string]$Message)
  Write-Host "[INFO] $Message"
}

$repoRoot = [System.IO.Path]::GetFullPath($RepoRoot)
$logDir = Join-Path $HOME ".jcgo\log"
$logFile = Join-Path $logDir $LogName

try {
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  Add-Content -LiteralPath $logFile -Value ("[{0}] {1} started args={2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Mode, ($DeployArgs -join " "))

  Write-Host "============================================"
  Write-Host "  JCGO Deploy"
  Write-Host "============================================"
  Write-Host
  Write-Info "Repository: $repoRoot"
  Write-Info "Log: $logFile"

  if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    throw "Go was not found in PATH. Install Go or run from a shell where go is available."
  }

  $extraArgs = @($DeployArgs | Where-Object { $_ -ne $null -and $_ -ne "" })
  $goArgs = @("run", "./cmd/jcgo-deploy", $Mode) + $extraArgs
  Write-Info ("Running: go {0}" -f ($goArgs -join " "))
  $stdout = Join-Path $env:TEMP ("jcgo-deploy-{0}.out" -f $PID)
  $stderr = Join-Path $env:TEMP ("jcgo-deploy-{0}.err" -f $PID)
  try {
    $process = Start-Process -FilePath "go" -ArgumentList $goArgs -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    foreach ($path in @($stdout, $stderr)) {
      if (Test-Path -LiteralPath $path) {
        Get-Content -LiteralPath $path -Encoding UTF8 | Tee-Object -FilePath $logFile -Append
      }
    }
    if ($process.ExitCode -ne 0) {
      throw "go exited with code $($process.ExitCode)"
    }
  } finally {
    Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue
  }

  Write-Host
  Write-Host "[OK] deploy complete"
  Wait-ForExit
  exit 0
} catch {
  Add-Content -LiteralPath $logFile -Value ("[{0}] failed: {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $_.Exception.Message)
  Write-Host
  Write-Host "[FAILED] $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Log: $logFile"
  Wait-ForExit
  exit 1
}
