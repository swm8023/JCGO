[CmdletBinding()]
param(
  [string]$JcgoDir = (Join-Path $env:USERPROFILE '.jcgo'),
  [string]$HubStateDir = (Join-Path $env:USERPROFILE '.wheelmaker')
)

$ErrorActionPreference = 'Stop'
$jcgoRoot = [IO.Path]::GetFullPath($JcgoDir)
$hubRoot = [IO.Path]::GetFullPath($HubStateDir)
$jcgoConfigPath = Join-Path $jcgoRoot 'config.json'
$hubConfigPath = Join-Path $hubRoot 'config.json'
$jcgoOriginal = [IO.File]::ReadAllText($jcgoConfigPath)
$hubOriginal = [IO.File]::ReadAllText($hubConfigPath)
$jcgoConfig = $jcgoOriginal | ConvertFrom-Json
$hubConfig = $hubOriginal | ConvertFrom-Json

function Set-Property($Object, [string]$Name, $Value) {
  $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
}

$definitions = @()
foreach ($role in @('server', 'worker')) {
  $id = "jcgo-$role"
  $binaryName = if ($role -eq 'server') { 'jcgo.exe' } else { 'jcgo-worker.exe' }
  $executable = Join-Path $jcgoRoot "bin/$binaryName"
  if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw "Install $binaryName before connecting WheelMaker." }
  $existing = @($hubConfig.apps | Where-Object { $_.id -eq $id })
  foreach ($entry in $existing) {
    if (-not [string]::Equals([IO.Path]::GetFullPath($entry.executable), $executable, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Hub application ID $id already belongs to another executable."
    }
  }
  $definitions += [pscustomobject]@{ id = $id; name = if ($role -eq 'server') { 'JCGO Server' } else { 'JCGO Worker' }; executable = $executable; args = @('--dir', $jcgoRoot); cwd = $jcgoRoot }
}

if ($null -eq $jcgoConfig.hub) { Set-Property $jcgoConfig 'hub' ([pscustomobject]@{}) }
Set-Property $jcgoConfig.hub 'enabled' $true
Set-Property $jcgoConfig.hub 'stateDir' $hubRoot
$otherApps = @($hubConfig.apps | Where-Object { $null -ne $_ -and $_.id -notin @('jcgo-server', 'jcgo-worker') })
Set-Property $hubConfig 'apps' @($otherApps + $definitions)

if ([IO.File]::ReadAllText($jcgoConfigPath) -cne $jcgoOriginal -or [IO.File]::ReadAllText($hubConfigPath) -cne $hubOriginal) {
  throw 'Configuration changed during preparation; retry the merge.'
}
$jcgoNext = ($jcgoConfig | ConvertTo-Json -Depth 100) + [Environment]::NewLine
$hubNext = ($hubConfig | ConvertTo-Json -Depth 100) + [Environment]::NewLine
$encoding = [Text.UTF8Encoding]::new($false)
function Write-Config([string]$Path, [string]$Content) {
  $temporary = $Path + '.jcgo-' + [guid]::NewGuid().ToString('N') + '.tmp'
  try {
    [IO.File]::WriteAllText($temporary, $Content, $encoding)
    [IO.File]::Replace($temporary, $Path, [NullString]::Value)
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
  }
}
Write-Config $jcgoConfigPath $jcgoNext
try { Write-Config $hubConfigPath $hubNext }
catch { Write-Config $jcgoConfigPath $jcgoOriginal; throw }
Write-Output 'Configured jcgo-server and jcgo-worker. Use Hub Apps > Monitor > Reload to start them.'
