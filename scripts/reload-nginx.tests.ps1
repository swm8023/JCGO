$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$launcherPath = Join-Path $repoRoot 'reload-nginx.bat'
$scriptPath = Join-Path $PSScriptRoot 'reload-nginx.ps1'

if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
    throw "launcher missing: $launcherPath"
}
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
    throw "elevated script missing: $scriptPath"
}

$launcher = Get-Content -Raw -LiteralPath $launcherPath
$script = Get-Content -Raw -LiteralPath $scriptPath

foreach ($required in @('%~dp0scripts\reload-nginx.ps1', 'ExecutionPolicy Bypass')) {
    if (-not $launcher.Contains($required)) {
        throw "launcher missing required text: $required"
    }
}

foreach ($required in @(
        'Start-Process',
        '-Verb RunAs',
        'nginx.exe',
        '-t',
        'Restart-Service',
        'no-cache'
    )) {
    if (-not $script.Contains($required)) {
        throw "elevated script missing required text: $required"
    }
}

Write-Output 'PASS: reload-nginx launcher contract'
