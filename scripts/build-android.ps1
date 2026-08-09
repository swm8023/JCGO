[CmdletBinding()]
param(
  [string]$OutputPath = 'dist\jcgo-android-debug.apk',
  [switch]$Install
)

$ErrorActionPreference = 'Stop'

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$androidRoot = Join-Path $repoRoot 'mobile\android'
$buildRoot = Join-Path $repoRoot 'dist\jcgo-android-gradle-build'
$outputFile = if ([System.IO.Path]::IsPathRooted($OutputPath)) {
  [System.IO.Path]::GetFullPath($OutputPath)
} else {
  [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputPath))
}

if (-not (Get-Command gradle -ErrorAction SilentlyContinue)) {
  throw 'gradle was not found in PATH.'
}
if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
  throw 'java was not found in PATH.'
}

$gradleArgs = @(
  'assembleDebug',
  '--no-daemon',
  "-PjcgoBuildRoot=$buildRoot"
)

Push-Location $androidRoot
try {
  & gradle @gradleArgs
  if ($LASTEXITCODE -ne 0) {
    throw "gradle exited with code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}

$builtApk = Join-Path $buildRoot 'app\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path -LiteralPath $builtApk -PathType Leaf)) {
  throw "Expected APK was not produced: $builtApk"
}

$outputDirectory = Split-Path -Parent $outputFile
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
Copy-Item -LiteralPath $builtApk -Destination $outputFile -Force
Write-Output "APK: $outputFile"

if ($Install) {
  if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
    throw 'adb was not found in PATH.'
  }
  & adb install -r $outputFile
  if ($LASTEXITCODE -ne 0) {
    throw "adb install exited with code $LASTEXITCODE."
  }
}
