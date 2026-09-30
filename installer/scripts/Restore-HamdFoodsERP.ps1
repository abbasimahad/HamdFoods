[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$AppRoot,
  [Parameter(Mandatory = $true)][string]$DataRoot,
  [switch]$Drill
)

# INST-9: puts a verified backup of this installation back into service (for example a prepared
# test baseline, or the state before a mistake). The current data is never deleted: a fresh
# backup is taken first, and the replaced database is kept, renamed, next to the restored one.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common-HamdFoodsERP.ps1')

if (-not (Test-HamdFoodsAdministrator)) {
  $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $arguments = @(
    '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath,
    '-AppRoot', $AppRoot, '-DataRoot', $DataRoot
  )
  if ($Drill) { $arguments += '-Drill' }
  $arguments = $arguments | ForEach-Object { ConvertTo-HamdFoodsWindowsCommandLineArgument -Value $_ }
  $elevated = Start-Process -FilePath $powershell -ArgumentList ($arguments -join ' ') -Verb RunAs -WindowStyle Normal -Wait -PassThru
  exit $elevated.ExitCode
}

$folder = if ($Drill) { 'HamdFoodsERP-InstallDrill' } else { 'HamdFoodsERP' }
$taskName = $folder
$log = $null
$runtimeStopped = $false

function Write-RestoreLog {
  param([string]$Message)
  if ($null -eq $log) { return }
  $safe = ConvertTo-HamdFoodsSafeLogText -Text $Message -SensitiveValues (@($env:POSTGRES_ADMIN_PASSWORD) + @(Get-HamdFoodsSensitiveValues))
  "[$([DateTimeOffset]::Now.ToString('O'))] $safe" | Out-File -LiteralPath $log -Append -Encoding utf8
}

function Invoke-RestoreNode {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)
  $release = Resolve-HamdFoodsActiveRelease -AppRoot $AppRoot
  $result = Invoke-HamdFoodsNativeProcess -FilePath $release.NodeExe -WorkingDirectory $AppRoot -Arguments $Arguments -SensitiveValues (@($env:POSTGRES_ADMIN_PASSWORD) + @(Get-HamdFoodsSensitiveValues))
  Write-RestoreLog -Message ($result.SafeStdOut.Trim())
  return $result.SafeStdOut
}

function Get-OperationsPath {
  param([Parameter(Mandatory = $true)][string]$Relative)
  return Join-Path (Resolve-HamdFoodsActiveRelease -AppRoot $AppRoot).OperationsDir $Relative
}

try {
  $expectedAppRoot = Join-Path (Get-HamdFoodsNativeProgramFiles) $folder
  $expectedDataRoot = Join-Path 'C:\ProgramData' $folder
  $AppRoot = Assert-HamdFoodsManagedPath -Path $AppRoot -Expected $expectedAppRoot
  $DataRoot = Assert-HamdFoodsManagedPath -Path $DataRoot -Expected $expectedDataRoot
  $log = Join-Path $DataRoot 'logs\restore.log'
  Import-HamdFoodsEnvironment -EnvironmentFile (Join-Path $DataRoot 'config\.env.production')
  $env:NODE_ENV = 'production'
  $port = [int]$env:PORT

  Write-Host 'Hamd Foods ERP - Restore a backup' -ForegroundColor Cyan
  Write-Host 'The current data is backed up first and kept; nothing is deleted.'
  $listing = Invoke-RestoreNode -Arguments @((Get-OperationsPath 'database-backup.mjs'), 'list-recent')
  $backups = @($listing.Trim() -split '\s+' | Where-Object { $_ -match '^[A-Za-z0-9][A-Za-z0-9._-]*@\S+$' })
  if (-not $backups.Count) { throw 'No completed backups were found.' }
  for ($index = 0; $index -lt $backups.Count; $index++) {
    $columns = $backups[$index] -split '@', 2
    $taken = ([DateTimeOffset]::Parse($columns[1])).ToOffset([TimeSpan]::FromHours(5)).ToString('dd/MM/yyyy HH:mm')
    Write-Host ("[{0}] {1}  (taken {2})" -f ($index + 1), $columns[0], $taken)
  }
  $selection = 0
  if (-not [int]::TryParse((Read-Host 'Backup number to restore'), [ref]$selection) -or $selection -lt 1 -or $selection -gt $backups.Count) {
    throw 'The backup selection is invalid.'
  }
  $backupId = ($backups[$selection - 1] -split '@', 2)[0]
  Write-Host "All data entered after backup $backupId will be replaced by that backup." -ForegroundColor Yellow
  if ((Read-Host 'Type RESTORE to continue') -cne 'RESTORE') { throw 'Restore cancelled; nothing was changed.' }
  $credential = Get-Credential -UserName 'postgres' -Message 'PostgreSQL 16 administrator password (used only for this restore, never stored).'
  if ($null -eq $credential) { throw 'Restore cancelled; nothing was changed.' }
  $env:POSTGRES_ADMIN_PASSWORD = $credential.GetNetworkCredential().Password
  Write-RestoreLog -Message "Restore of $backupId requested."

  Write-Host 'Stopping the ERP...'
  $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $stopArguments = @('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'Setup-HamdFoodsERP.ps1'),
    '-Mode', 'StopRuntime', '-AppRoot', $AppRoot, '-DataRoot', $DataRoot, '-TaskName', $taskName, '-BackupTaskName', "$taskName-Backup",
    '-Port', [string]$port, '-DatabaseName', ([Uri]$env:DATABASE_URL).AbsolutePath.TrimStart('/'), '-RoleName', ([Uri]$env:DATABASE_URL).UserInfo.Split(':')[0])
  if ($Drill) { $stopArguments += '-Drill' }
  $stopArguments = $stopArguments | ForEach-Object { ConvertTo-HamdFoodsWindowsCommandLineArgument -Value $_ }
  $stop = Start-Process -FilePath $powershell -ArgumentList ($stopArguments -join ' ') -WindowStyle Hidden -Wait -PassThru
  if ($stop.ExitCode -ne 0) { throw 'The ERP could not be stopped safely; nothing was changed.' }
  $runtimeStopped = $true

  Write-Host 'Backing up the current data...'
  Invoke-RestoreNode -Arguments @((Get-OperationsPath 'database-backup.mjs'), 'create') | Out-Null
  Write-Host "Restoring $backupId (checked before it replaces anything)..."
  $restoreOutput = Invoke-RestoreNode -Arguments @((Get-OperationsPath 'database-backup.mjs'), 'restore-live', $backupId)
  Write-Host $restoreOutput.Trim()
  Remove-Item Env:POSTGRES_ADMIN_PASSWORD -ErrorAction SilentlyContinue

  Write-Host 'Bringing the restored data up to this version...'
  Invoke-RestoreNode -Arguments @((Get-OperationsPath 'node_modules\prisma\build\index.js'), 'migrate', 'deploy', '--config', (Get-OperationsPath 'prisma.config.mjs')) | Out-Null
  Invoke-RestoreNode -Arguments @('--conditions=react-server', (Get-OperationsPath 'seed-all.mjs')) | Out-Null

  Start-ScheduledTask -TaskName $taskName
  $runtimeStopped = $false
  if (-not (Wait-HamdFoodsHealthy -Port $port -TimeoutSeconds 90)) { throw 'The ERP did not become healthy after the restore; see logs\application.log.' }
  Write-RestoreLog -Message "Restore of $backupId completed."
  Write-Host "Restore complete. The ERP is running with backup $backupId." -ForegroundColor Green
  [void](Read-Host 'Press Enter to close')
} catch {
  $safe = ConvertTo-HamdFoodsSafeLogText -Text $_.Exception.Message -SensitiveValues (@($env:POSTGRES_ADMIN_PASSWORD) + @(Get-HamdFoodsSensitiveValues))
  Write-RestoreLog -Message "Restore failed: $safe"
  if ($runtimeStopped) { Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue }
  Write-Error $safe
  [void](Read-Host 'Press Enter to close')
  exit 1
} finally {
  Remove-Item Env:POSTGRES_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:BETTER_AUTH_SECRET -ErrorAction SilentlyContinue
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
