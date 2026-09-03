[CmdletBinding()]
param(
  [ValidateSet('Install', 'Repair', 'UninstallTasks')][string]$Mode = 'Install',
  [string]$AppRoot = 'C:\Program Files\HamdFoodsERP',
  [string]$DataRoot = 'C:\ProgramData\HamdFoodsERP',
  [string]$TaskName = 'HamdFoodsERP',
  [string]$BackupTaskName = 'HamdFoodsERP-Backup',
  [ValidateRange(1, 65535)][int]$Port = 3100,
  [string]$DatabaseName = 'hamd_foods_erp',
  [string]$RoleName = 'hamd_erp',
  [switch]$InstallBackupTask,
  [switch]$Drill
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common-HamdFoodsERP.ps1')

$expected = if ($Drill) {
  @{
    AppRoot = 'C:\Program Files\HamdFoodsERP-InstallDrill'; DataRoot = 'C:\ProgramData\HamdFoodsERP-InstallDrill'
    TaskName = 'HamdFoodsERP-InstallDrill'; BackupTaskName = 'HamdFoodsERP-InstallDrill-Backup'
    Port = 3200; DatabaseName = 'hamd_foods_erp_installer_drill'; RoleName = 'hamd_erp_installer_drill'
  }
} else {
  @{
    AppRoot = 'C:\Program Files\HamdFoodsERP'; DataRoot = 'C:\ProgramData\HamdFoodsERP'
    TaskName = 'HamdFoodsERP'; BackupTaskName = 'HamdFoodsERP-Backup'
    Port = 3100; DatabaseName = 'hamd_foods_erp'; RoleName = 'hamd_erp'
  }
}

function Invoke-HamdFoodsSetup {
if (-not (Test-HamdFoodsAdministrator)) { throw 'Hamd Foods ERP setup requires an elevated Administrator token.' }
$AppRoot = Assert-HamdFoodsManagedPath -Path $AppRoot -Expected $expected.AppRoot
$DataRoot = Assert-HamdFoodsManagedPath -Path $DataRoot -Expected $expected.DataRoot
foreach ($key in @('TaskName', 'BackupTaskName', 'Port', 'DatabaseName', 'RoleName')) {
  if (-not $Drill -and $key -eq 'Port') { continue }
  if ((Get-Variable -Name $key -ValueOnly).ToString() -ne $expected[$key].ToString()) {
    throw "The requested $key is not valid for this installation mode."
  }
}
if ($DatabaseName -notmatch '^[a-z][a-z0-9_]{0,62}$' -or $RoleName -notmatch '^[a-z][a-z0-9_]{0,62}$' -or $RoleName -eq 'postgres') {
  throw 'PostgreSQL resource identifiers are invalid.'
}
if ($TaskName -notmatch '^HamdFoodsERP(?:-InstallDrill)?$' -or $BackupTaskName -notmatch '^HamdFoodsERP(?:-InstallDrill)?-Backup$') {
  throw 'Scheduled Task identifiers are invalid.'
}
if ($Port -eq 5432) { throw 'The ERP cannot use the PostgreSQL port.' }

if ($Mode -eq 'UninstallTasks') {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $BackupTaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output 'Business data and backups were preserved.'
  exit 0
}

$configDirectory = Join-Path $DataRoot 'config'
$configPath = Join-Path $configDirectory '.env.production'
$logRoot = Join-Path $DataRoot 'logs'
$installerLogRoot = Join-Path $logRoot 'installer'
$backupRoot = Join-Path $DataRoot 'backups'
$stateRoot = Join-Path $DataRoot 'state'
$createdDatabase = $false
$createdRole = $false
$fresh = -not (Test-Path -LiteralPath $configPath -PathType Leaf)

try {
  Assert-PortAvailableOrOwned -Port $Port -TaskName $TaskName
  $postgres = Find-SupportedPostgres
  Assert-PostgresLoopback -Postgres $postgres

  foreach ($directory in @($DataRoot, $configDirectory, $logRoot, $installerLogRoot, $backupRoot, $stateRoot)) {
    if (Test-Path -LiteralPath $directory) {
      $existingItem = Get-Item -LiteralPath $directory -Force
      if (($existingItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Managed ProgramData paths cannot be reparse points.' }
    }
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }
  if (Test-Path -LiteralPath $configPath) {
    $configItem = Get-Item -LiteralPath $configPath -Force
    if (($configItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Protected configuration cannot be a reparse point.' }
  }
  Protect-HamdFoodsPath -Path $DataRoot -Container

  if ($fresh) {
    $credential = Get-Credential -UserName 'postgres' -Message 'Enter the PostgreSQL 16 administrator password. It is used only for provisioning and is not stored.'
    $postgresPassword = ConvertFrom-SecureValue $credential.Password
    $existing = Get-PostgresResourceState -Postgres $postgres -Password $postgresPassword
    if ($existing.Database -or $existing.Role) {
      throw 'A matching PostgreSQL database or role already exists without managed configuration; setup will not claim it.'
    }
    $secrets = New-InstallationSecrets
    New-PostgresResources -Postgres $postgres -Password $postgresPassword -DatabasePassword $secrets.DatabasePassword
    $createdRole = $true
    $createdDatabase = $true
    Write-ProtectedConfiguration -DatabasePassword $secrets.DatabasePassword -AuthSecret $secrets.AuthSecret -Postgres $postgres
  } else {
    Import-HamdFoodsEnvironment -EnvironmentFile $configPath
    Assert-ExistingConfiguration
    Invoke-InstalledBackup -Verify
  }

  Import-HamdFoodsEnvironment -EnvironmentFile $configPath
  Invoke-InstalledMigrations
  Invoke-InstalledSeed
  if ($fresh) { Invoke-AdminBootstrap }
  Register-ApplicationTask
  if ($InstallBackupTask) { Register-BackupTask } else { Unregister-ScheduledTask -TaskName $BackupTaskName -Confirm:$false -ErrorAction SilentlyContinue }
  Start-ScheduledTask -TaskName $TaskName
  Wait-Healthy
  if ($fresh) { Invoke-InstalledBackup -Verify }
  Write-Output 'Hamd Foods ERP installation verification passed.'
} catch {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($fresh) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $BackupTaskName -Confirm:$false -ErrorAction SilentlyContinue
  }
  if ($fresh -and $createdDatabase -and $createdRole) {
    Write-Warning 'Application database resources were created before setup failed and were preserved for safe operator review.'
  }
  throw
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:BOOTSTRAP_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:BOOTSTRAP_ADMIN_EMAIL -ErrorAction SilentlyContinue
  Remove-Item Env:BOOTSTRAP_ADMIN_NAME -ErrorAction SilentlyContinue
}
}

function Find-SupportedPostgres {
  $root = Join-Path $env:ProgramFiles 'PostgreSQL'
  $detected = if (Test-Path -LiteralPath $root) { @(Get-ChildItem -LiteralPath $root -Directory | Where-Object Name -Match '^\d+$') } else { @() }
  $unsupported = @($detected | Where-Object Name -NE '16')
  if ($unsupported.Count) { throw "Unsupported/conflicting PostgreSQL major detected: $($unsupported.Name -join ', ')." }
  $bin = Join-Path $root '16\bin'
  $service = Get-Service -Name 'postgresql-x64-16' -ErrorAction SilentlyContinue
  $tools = @('psql.exe', 'pg_isready.exe', 'pg_dump.exe', 'pg_restore.exe')
  if (-not $service -or ($tools | Where-Object { -not (Test-Path -LiteralPath (Join-Path $bin $_) -PathType Leaf) })) {
    $prerequisite = Join-Path $AppRoot 'prerequisites\postgresql-16-windows-x64.exe'
    if (Test-Path -LiteralPath $prerequisite -PathType Leaf) {
      Write-Host 'PostgreSQL 16 is required. The official prerequisite installer will open; choose a strong administrator password and retain loopback-only networking.'
      $process = Start-Process -FilePath $prerequisite -Wait -PassThru
      if ($process.ExitCode -ne 0) { throw 'PostgreSQL prerequisite installation did not complete successfully.' }
      $service = Get-Service -Name 'postgresql-x64-16' -ErrorAction SilentlyContinue
    } else {
      throw 'PostgreSQL 16 for Windows is required. Install the official EDB package, including command-line tools, then rerun setup.'
    }
  }
  if (-not $service -or $service.Status -ne 'Running') { throw 'The PostgreSQL 16 Windows service is not running.' }
  if ($tools | Where-Object { -not (Test-Path -LiteralPath (Join-Path $bin $_) -PathType Leaf) }) { throw 'The PostgreSQL 16 command-line tools are incomplete.' }
  return @{ Bin = $bin; Psql = (Join-Path $bin 'psql.exe'); PgIsReady = (Join-Path $bin 'pg_isready.exe') }
}

function Assert-PostgresLoopback {
  param([hashtable]$Postgres)
  & $Postgres.PgIsReady -h 127.0.0.1 -p 5432 -t 5 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL is not reachable on loopback.' }
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 5432 -ErrorAction SilentlyContinue)
  if (-not $listeners.Count -or @($listeners | Where-Object LocalAddress -NotIn @('127.0.0.1', '::1')).Count) {
    throw 'PostgreSQL must listen only on 127.0.0.1 and/or ::1.'
  }
}

function Assert-PortAvailableOrOwned {
  param([int]$Port, [string]$TaskName)
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
  if (-not $listeners.Count) { return }
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $task -or @($listeners | Where-Object LocalAddress -NotIn @('127.0.0.1', '::1')).Count) {
    throw "Port $Port is occupied; setup will not terminate or hijack the listener."
  }
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
    throw "Port $Port remains occupied after stopping the managed task."
  }
}

function ConvertFrom-SecureValue {
  param([Security.SecureString]$Value)
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function New-RandomHex {
  param([int]$Bytes)
  $buffer = [byte[]]::new($Bytes)
  [Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
  return [Convert]::ToHexString($buffer).ToLowerInvariant()
}

function New-InstallationSecrets { return @{ DatabasePassword = (New-RandomHex 32); AuthSecret = (New-RandomHex 48) } }

function Invoke-Psql {
  param([hashtable]$Postgres, [string]$Password, [string]$Database = 'postgres', [string]$File, [string]$Command)
  $env:PGPASSWORD = $Password
  try {
    $arguments = @('-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', '5432', '-U', 'postgres', '-d', $Database)
    if ($File) { $arguments += @('-f', $File) } else { $arguments += @('-Atc', $Command) }
    $output = & $Postgres.Psql @arguments
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL command failed.' }
    return $output
  } finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
}

function Get-PostgresResourceState {
  param([hashtable]$Postgres, [string]$Password)
  $role = Invoke-Psql -Postgres $Postgres -Password $Password -Command "SELECT 1 FROM pg_roles WHERE rolname = '$RoleName'"
  $database = Invoke-Psql -Postgres $Postgres -Password $Password -Command "SELECT 1 FROM pg_database WHERE datname = '$DatabaseName'"
  return @{ Role = [bool]$role; Database = [bool]$database }
}

function New-PostgresResources {
  param([hashtable]$Postgres, [string]$Password, [string]$DatabasePassword)
  $temporary = Join-Path $stateRoot ("provision-{0}.sql" -f [Guid]::NewGuid().ToString('N'))
  try {
    [IO.File]::WriteAllText($temporary, "CREATE ROLE $RoleName LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '$DatabasePassword';`nCREATE DATABASE $DatabaseName OWNER $RoleName;`n", [Text.UTF8Encoding]::new($false))
    Protect-HamdFoodsPath -Path $temporary
    Invoke-Psql -Postgres $Postgres -Password $Password -File $temporary | Out-Null
  } finally { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
}

function Write-ProtectedConfiguration {
  param([string]$DatabasePassword, [string]$AuthSecret, [hashtable]$Postgres)
  $databaseUrl = "postgresql://${RoleName}:${DatabasePassword}@127.0.0.1:5432/${DatabaseName}"
  $lines = @(
    'APP_ENV=production', 'HOSTNAME=127.0.0.1', "PORT=$Port", "DATABASE_URL=$databaseUrl",
    "BETTER_AUTH_SECRET=$AuthSecret", "BETTER_AUTH_URL=http://127.0.0.1:$Port",
    "BACKUP_DIRECTORY=$backupRoot", 'BACKUP_KEEP_LAST=14', 'BACKUP_KEEP_DAYS=30', "POSTGRES_BIN=$($Postgres.Bin)"
  )
  [IO.File]::WriteAllText($configPath, (($lines -join "`r`n") + "`r`n"), [Text.UTF8Encoding]::new($false))
  Protect-HamdFoodsPath -Path $configPath
}

function Assert-ExistingConfiguration {
  try { $databaseUri = [Uri]::new($env:DATABASE_URL) } catch { throw 'Existing database configuration is invalid.' }
  $expectedBackup = [IO.Path]::GetFullPath($backupRoot).TrimEnd('\')
  $actualBackup = [IO.Path]::GetFullPath($env:BACKUP_DIRECTORY).TrimEnd('\')
  if (
    $env:APP_ENV -ne 'production' -or
    $env:HOSTNAME -ne '127.0.0.1' -or
    $env:PORT -ne $Port.ToString() -or
    $env:BETTER_AUTH_URL -ne "http://127.0.0.1:$Port" -or
    $databaseUri.Scheme -notin @('postgres', 'postgresql') -or
    $databaseUri.Host -notin @('127.0.0.1', 'localhost', '::1') -or
    $databaseUri.Port -ne 5432 -or
    $databaseUri.AbsolutePath.TrimStart('/') -ne $DatabaseName -or
    -not $databaseUri.UserInfo.StartsWith("${RoleName}:") -or
    -not $actualBackup.Equals($expectedBackup, [StringComparison]::OrdinalIgnoreCase) -or
    -not ([IO.Path]::GetFullPath($env:POSTGRES_BIN).TrimEnd('\')).Equals([IO.Path]::GetFullPath($postgres.Bin).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)
  ) {
    throw 'Existing managed configuration does not satisfy loopback installation requirements.'
  }
  Protect-HamdFoodsPath -Path $configPath
}

function Invoke-InstalledMigrations {
  $cli = Join-Path $AppRoot 'operations\node_modules\prisma\build\index.js'
  Invoke-HamdFoodsNode -AppRoot $AppRoot -Arguments @($cli, 'migrate', 'deploy', '--config', (Join-Path $AppRoot 'operations\prisma.config.mjs'))
}

function Invoke-InstalledSeed {
  Invoke-HamdFoodsNode -AppRoot $AppRoot -Arguments @((Join-Path $AppRoot 'operations\seed-all.mjs'))
}

function Invoke-AdminBootstrap {
  $name = Read-Host 'Initial SUPER_ADMIN name'
  $email = Read-Host 'Initial SUPER_ADMIN email'
  if ([string]::IsNullOrWhiteSpace($name) -or $email -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') { throw 'A valid administrator name and email are required.' }
  $first = Read-Host 'Initial SUPER_ADMIN password (8-128 characters)' -AsSecureString
  $second = Read-Host 'Confirm initial SUPER_ADMIN password' -AsSecureString
  $password = ConvertFrom-SecureValue $first
  $confirmation = ConvertFrom-SecureValue $second
  try {
    if ($password.Length -lt 8 -or $password.Length -gt 128 -or $password -cne $confirmation) { throw 'Administrator passwords are invalid or do not match.' }
    $env:BOOTSTRAP_ADMIN_NAME = $name.Trim()
    $env:BOOTSTRAP_ADMIN_EMAIL = $email.Trim().ToLowerInvariant()
    $env:BOOTSTRAP_ADMIN_PASSWORD = $password
    Invoke-HamdFoodsNode -AppRoot $AppRoot -Arguments @((Join-Path $AppRoot 'operations\bootstrap-super-admin.mjs'))
  } finally {
    $password = $null; $confirmation = $null
    Remove-Item Env:BOOTSTRAP_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:BOOTSTRAP_ADMIN_EMAIL -ErrorAction SilentlyContinue
    Remove-Item Env:BOOTSTRAP_ADMIN_NAME -ErrorAction SilentlyContinue
  }
}

function Register-ApplicationTask {
  $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $runner = Join-Path $AppRoot 'windows\Run-HamdFoodsERP.ps1'
  $drillArgument = if ($Drill) { ' -Drill' } else { '' }
  $arguments = "-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`" -AppRoot `"$AppRoot`" -DataRoot `"$DataRoot`"$drillArgument"
  $action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $AppRoot
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
}

function Register-BackupTask {
  $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $runner = Join-Path $AppRoot 'windows\Backup-HamdFoodsERP.ps1'
  $drillArgument = if ($Drill) { ' -Drill' } else { '' }
  $arguments = "-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`" -AppRoot `"$AppRoot`" -DataRoot `"$DataRoot`"$drillArgument"
  $action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $AppRoot
  $trigger = New-ScheduledTaskTrigger -Daily -At '02:00'
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  Register-ScheduledTask -TaskName $BackupTaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
}

function Invoke-InstalledBackup {
  param([switch]$Verify)
  Invoke-HamdFoodsNode -AppRoot $AppRoot -Arguments @((Join-Path $AppRoot 'operations\database-backup.mjs'), 'create')
  if ($Verify) {
    $manifest = Get-ChildItem -LiteralPath $backupRoot -Filter '*.manifest.json' -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if (-not $manifest) { throw 'Backup verification could not locate a completed manifest.' }
    $identifier = $manifest.Name.Substring(0, $manifest.Name.Length - '.manifest.json'.Length)
    Invoke-HamdFoodsNode -AppRoot $AppRoot -Arguments @((Join-Path $AppRoot 'operations\database-backup.mjs'), 'verify', $identifier)
  }
}

function Wait-Healthy {
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  do {
    try {
      $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 5
      if ($response.status -eq 'ok') { return }
    } catch { Start-Sleep -Seconds 2 }
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'Installed application did not become healthy within 60 seconds.'
}

Invoke-HamdFoodsSetup
