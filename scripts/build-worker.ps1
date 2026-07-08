$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $repoRoot 'dist\worker'
$exePath = Join-Path $outDir 'jcgo-worker.exe'
$exampleSource = Join-Path $repoRoot 'configs\jcgo-worker.example.json'
$exampleDest = Join-Path $outDir 'jcgo-worker.example.json'
$configDest = Join-Path $outDir 'jcgo-worker.json'

New-Item -ItemType Directory -Force $outDir | Out-Null

Push-Location $repoRoot
try {
    go build -o $exePath .\cmd\jcgo-worker
}
finally {
    Pop-Location
}

Copy-Item -Force $exampleSource $exampleDest
if (-not (Test-Path $configDest)) {
    Copy-Item $exampleSource $configDest
}

Write-Host "Built $exePath"
Write-Host "Edit $configDest before running jcgo-worker.exe"
