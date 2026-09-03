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
$AppRoot = Assert-HamdFoodsManagedPath -Path $AppRoot -Expected $expectedApp
$DataRoot = Assert-HamdFoodsManagedPath -Path $DataRoot -Expected $expectedData
$environmentFile = Join-Path $DataRoot "config\.env.production"
$server = Join-Path $AppRoot "app\server.js"
$log = Join-Path $DataRoot "logs\application.log"
if (-not (Test-Path -LiteralPath $server -PathType Leaf)) { throw "Installed application runtime is missing." }

Import-HamdFoodsEnvironment -EnvironmentFile $environmentFile
$env:HAMDFOODS_ENV_FILE = $environmentFile
$env:HAMDFOODS_DATA_ROOT = $DataRoot
$env:NODE_ENV = "production"
$env:NODE_OPTIONS = "--enable-source-maps"
Set-Location -LiteralPath (Join-Path $AppRoot "app")

try {
  Invoke-HamdFoodsNode -AppRoot $AppRoot -Arguments @($server) *>> $log
} catch {
  "[$([DateTimeOffset]::Now.ToString('O'))] Installed runtime stopped: $($_.Exception.Message)" | Out-File -LiteralPath $log -Append -Encoding utf8
  throw
}
