[CmdletBinding()]
param(
    [string]$NginxRoot = 'D:\Nginx\nginx-1.29.5',
    [string]$ServiceName = 'nginx',
    [string]$RemoteUrl = 'https://vimernas.myqnapcloud.com:28802/'
)

$ErrorActionPreference = 'Stop'

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Restart-Elevated {
    try {
        $arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
        $elevated = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arguments -Wait -PassThru
        exit $elevated.ExitCode
    } catch {
        Write-Host "[FAILED] Administrator elevation was cancelled or failed: $($_.Exception.Message)" -ForegroundColor Red
        Read-Host 'Press Enter to close'
        exit 1
    }
}

if (-not (Test-IsAdministrator)) {
    Restart-Elevated
}

try {
    $nginxExe = Join-Path $NginxRoot 'nginx.exe'
    if (-not (Test-Path -LiteralPath $nginxExe -PathType Leaf)) {
        throw "Nginx executable not found: $nginxExe"
    }

    Write-Host "[INFO] Checking Nginx configuration..."
    & $nginxExe -t -p $NginxRoot -c 'conf\nginx.conf'
    if ($LASTEXITCODE -ne 0) {
        throw "Nginx configuration test failed with exit code $LASTEXITCODE"
    }

    Write-Host "[INFO] Restarting Windows service: $ServiceName"
    Restart-Service -Name $ServiceName -Force
    $service = Get-Service -Name $ServiceName
    if ($service.Status -ne 'Running') {
        throw "Nginx service is not running after restart: $($service.Status)"
    }

    Write-Host "[INFO] Checking remote cache headers: $RemoteUrl"
    $response = $null
    for ($attempt = 1; $attempt -le 10; $attempt++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $RemoteUrl
            break
        } catch {
            if ($attempt -eq 10) {
                throw "Remote entry check failed after $attempt attempts: $($_.Exception.Message)"
            }
            Start-Sleep -Milliseconds 500
        }
    }

    $cacheControl = [string]$response.Headers['Cache-Control']
    if ($cacheControl -notmatch 'no-cache') {
        throw "Remote entry still has unexpected Cache-Control: '$cacheControl'"
    }

    Write-Host "[OK] Nginx restarted successfully."
    Write-Host "[OK] Remote Cache-Control: $cacheControl"
    Write-Host "[NEXT] Fully close and reopen the APK."
    Read-Host 'Press Enter to close'
    exit 0
} catch {
    Write-Host "[FAILED] $($_.Exception.Message)" -ForegroundColor Red
    Read-Host 'Press Enter to close'
    exit 1
}
