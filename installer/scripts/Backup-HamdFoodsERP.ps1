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
$mutexName = if ($Drill) { "Global\HamdFoodsERP-InstallDrill-Backup" } else { "Global\HamdFoodsERP-Backup" }
$log = Join-Path $DataRoot "logs\backup.log"
$mutex = [Threading.Mutex]::new($false, $mutexName)
$acquired = $false

try {
  $acquired = $mutex.WaitOne(0)
  if (-not $acquired) { "Backup skipped because another backup is running."; exit 0 }
  Import-HamdFoodsEnvironment -EnvironmentFile (Join-Path $DataRoot "config\.env.production")
  $env:NODE_ENV = "production"
  Set-Location -LiteralPath (Join-Path $AppRoot "operations")
  Invoke-HamdFoodsNode -AppRoot $AppRoot -Arguments @((Join-Path $AppRoot "operations\database-backup.mjs"), "create") *>> $log
} catch {
  "[$([DateTimeOffset]::Now.ToString('O'))] Backup failed: $($_.Exception.Message)" | Out-File -LiteralPath $log -Append -Encoding utf8
  throw
} finally {
  if ($acquired) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
