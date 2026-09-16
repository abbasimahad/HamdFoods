[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$AppRoot,
  [Parameter(Mandatory = $true)][string]$DataRoot,
  [switch]$Drill
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Common-HamdFoodsERP.ps1")

$expectedApp = if ($Drill) { "C:\Program Files\HamdFoodsERP-InstallDrill" } else { "C:\Program Files\HamdFoodsERP" }
$expectedData = if ($Drill) { "C:\ProgramData\HamdFoodsERP-InstallDrill" } else { "C:\ProgramData\HamdFoodsERP" }
$log = Join-Path $DataRoot "logs\application.log"

try {
  $AppRoot = Assert-HamdFoodsManagedPath -Path $AppRoot -Expected $expectedApp
  $DataRoot = Assert-HamdFoodsManagedPath -Path $DataRoot -Expected $expectedData
  $environmentFile = Join-Path $DataRoot "config\.env.production"

  # Phase 34: prefer the active-release pointer if this installation has
  # ever received an update; an installation that never has keeps running
  # the original flat layout unchanged (see Common-HamdFoodsERP.ps1's
  # Resolve-HamdFoodsActiveRelease doc comment). Every release directory is
  # self-contained (Update-HamdFoodsERP.ps1 copies a runtime into any
  # release that does not ship its own), so no fallback is needed here.
  $release = Resolve-HamdFoodsActiveRelease -AppRoot $AppRoot
  $server = Join-Path $release.AppDir "server.js"
  if (-not (Test-Path -LiteralPath $server -PathType Leaf)) { throw "Installed application runtime is missing." }
  if (-not (Test-Path -LiteralPath $release.NodeExe -PathType Leaf)) { throw "Installed Node runtime is missing." }

  Import-HamdFoodsEnvironment -EnvironmentFile $environmentFile
  $env:HAMDFOODS_ENV_FILE = $environmentFile
  $env:HAMDFOODS_DATA_ROOT = $DataRoot
  $env:NODE_ENV = "production"
  Set-Location -LiteralPath $release.AppDir

  Invoke-HamdFoodsNativeProcess -FilePath $release.NodeExe -WorkingDirectory $release.AppDir -Arguments @($server) -SensitiveValues (Get-HamdFoodsSensitiveValues) *>> $log
} catch {
  $safeMessage = ConvertTo-HamdFoodsSafeLogText -Text $_.Exception.Message -SensitiveValues (Get-HamdFoodsSensitiveValues)
  New-Item -ItemType Directory -Path (Split-Path -Parent $log) -Force -ErrorAction SilentlyContinue | Out-Null
  "[$([DateTimeOffset]::Now.ToString('O'))] Installed runtime stopped: $safeMessage" | Out-File -LiteralPath $log -Append -Encoding utf8
  throw
}
