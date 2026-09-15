[CmdletBinding()]
param(
  [ValidateSet('Install', 'Repair', 'StopRuntime', 'UninstallTasks')][string]$Mode = 'Install',
  [string]$AppRoot = 'C:\Program Files\HamdFoodsERP',
  [string]$DataRoot = 'C:\ProgramData\HamdFoodsERP',
  [string]$TaskName = 'HamdFoodsERP',
  [string]$BackupTaskName = 'HamdFoodsERP-Backup',
  [ValidateRange(1, 65535)][int]$Port = 3100,
  [string]$DatabaseName = 'hamd_foods_erp',
  [string]$RoleName = 'hamd_erp',
  [switch]$InstallBackupTask,
  [switch]$Drill,
  [string]$LicenseFile
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

if ($Mode -eq 'StopRuntime') {
  try { Stop-HamdFoodsManagedRuntime }
  catch {
    $runtimeStopLog = Join-Path $DataRoot 'logs\installer\runtime-stop.log'
    New-Item -ItemType Directory -Path (Split-Path -Parent $runtimeStopLog) -Force | Out-Null
    $safeMessage = ConvertTo-HamdFoodsSafeLogText -Text $_.Exception.Message -SensitiveValues (Get-HamdFoodsSensitiveValues)
    "[$([DateTimeOffset]::Now.ToString('O'))] $safeMessage" | Out-File -LiteralPath $runtimeStopLog -Append -Encoding utf8
    Protect-HamdFoodsPath -Path $runtimeStopLog
    throw
  }
  Write-Output 'Hamd Foods ERP runtime stopped for protected repair.'
  exit 0
}

if ($Mode -eq 'UninstallTasks') {
  Remove-HamdFoodsScheduledTasks
  Write-Output 'Business data and backups were preserved.'
  exit 0
}

$configDirectory = Join-Path $DataRoot 'config'
$configPath = Join-Path $configDirectory '.env.production'
$logRoot = Join-Path $DataRoot 'logs'
$installerLogRoot = Join-Path $logRoot 'installer'
$provisioningLogPath = Join-Path $installerLogRoot 'provisioning.log'
$backupRoot = Join-Path $DataRoot 'backups'
$stateRoot = Join-Path $DataRoot 'state'
$statePath = Join-Path $stateRoot 'provisioning-state.json'
$installationId = if ($Drill) { 'EEEA3D20-202A-4B36-8145-41EC53AECA63' } else { 'B751DA7E-CAEF-4619-981F-BD49A7CDE978' }
$createdDatabase = $false
$createdRole = $false
$fresh = -not (Test-Path -LiteralPath $configPath -PathType Leaf)
$repair = $false
$managedState = $null
$stage = 'ProgramDataPreparation'
$postgresPassword = $null
$secrets = $null

try {
  if (Test-Path -LiteralPath $configPath -PathType Leaf) {
    if (-not (Test-HamdFoodsRestrictedPath -Path $DataRoot) -or -not (Test-HamdFoodsRestrictedPath -Path $configPath)) {
      throw 'Existing configuration lacks installer-owned protected ACL provenance; setup will not claim it.'
    }
    if (Test-Path -LiteralPath $statePath -PathType Leaf) {
      if (-not (Test-HamdFoodsRestrictedPath -Path $statePath)) { throw 'Existing installer state is not protected.' }
    } elseif (-not (Test-Path -LiteralPath $provisioningLogPath -PathType Leaf) -or -not (Test-HamdFoodsRestrictedPath -Path $provisioningLogPath)) {
      throw 'Existing configuration has neither protected installer state nor protected legacy provisioning evidence.'
    }
  }
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
  Write-HamdFoodsProvisioningEvent -Path $provisioningLogPath -Stage $stage -Status 'PASS'

  $stage = 'PortValidation'
  Assert-PortAvailableOrOwned -Port $Port -TaskName $TaskName
  Write-HamdFoodsProvisioningEvent -Path $provisioningLogPath -Stage $stage -Status 'PASS'

  $stage = 'PostgreSQLDiscovery'
  $postgres = Find-SupportedPostgres
  Write-HamdFoodsProvisioningEvent -Path $provisioningLogPath -Stage $stage -Status 'PASS'

  $stage = 'PostgreSQLNetworkValidation'
  Assert-PostgresLoopback -Postgres $postgres
  Write-HamdFoodsProvisioningEvent -Path $provisioningLogPath -Stage $stage -Status 'PASS'

  if ($fresh) {
    if (Test-Path -LiteralPath $statePath -PathType Leaf) {
      $managedState = Read-HamdFoodsProvisioningState
      Assert-HamdFoodsProvisioningState -State $managedState
      if ($managedState.ResourcesCreated.Database -or $managedState.ResourcesCreated.Role) {
        throw 'Installer-owned state records created PostgreSQL resources but protected configuration is missing; automatic recovery cannot preserve its generated credential.'
      }
    } else {
      $managedState = New-HamdFoodsProvisioningState
      Save-HamdFoodsProvisioningState -State $managedState
    }

    $stage = 'PostgreSQLCredentialAcquisition'
    $postgresPassword = Get-PostgresAdministratorPassword
    Write-HamdFoodsProvisioningEvent -Path $provisioningLogPath -Stage $stage -Status 'PASS'

    $stage = 'PostgreSQLCredentialValidation'
    $existing = Get-PostgresResourceState -Postgres $postgres -Password $postgresPassword
    if ($existing.Database -or $existing.Role) {
      throw 'A matching PostgreSQL database or role already exists without matching installer provenance; setup will not claim it.'
    }
    Write-HamdFoodsProvisioningEvent -Path $provisioningLogPath -Stage $stage -Status 'PASS'

    $stage = 'SecretGeneration'
    $secrets = New-InstallationSecrets
    Write-HamdFoodsProvisioningEvent -Path $provisioningLogPath -Stage $stage -Status 'PASS'

    $stage = 'DatabaseProvisioning'
    New-PostgresResources -Postgres $postgres -Password $postgresPassword -DatabasePassword $secrets.DatabasePassword
    $createdRole = $true
    $createdDatabase = $true
    $managedState.ResourcesCreated.Role = $true
    $managedState.ResourcesCreated.Database = $true
    Save-HamdFoodsProvisioningState -State $managedState
    Write-HamdFoodsProvisioningEvent -Path $provisioningLogPath -Stage $stage -Status 'PASS'

    $stage = 'ConfigurationWrite'
    Write-ProtectedConfiguration -DatabasePassword $secrets.DatabasePassword -AuthSecret $secrets.AuthSecret -Postgres $postgres
    Write-HamdFoodsProvisioningEvent -Path $provisioningLogPath -Stage $stage -Status 'PASS'
    Complete-HamdFoodsProvisioningStage -State $managedState -Stage $stage

    Register-PreSuppliedLicense
  } else {
    $stage = 'ConfigurationValidation'
    Import-HamdFoodsEnvironment -EnvironmentFile $configPath
    Assert-ExistingConfiguration
    Write-HamdFoodsProvisioningEvent -Path $provisioningLogPath -Stage $stage -Status 'PASS'

    if (Test-Path -LiteralPath $statePath -PathType Leaf) {
      $managedState = Read-HamdFoodsProvisioningState
    } else {
      $managedState = Import-HamdFoodsLegacyProvisioningState
    }
    Assert-HamdFoodsProvisioningState -State $managedState -RequireResources
    $managedState.ApplicationVersion = Get-HamdFoodsInstalledVersion
    Save-HamdFoodsProvisioningState -State $managedState
    $repair = [bool]$managedState.ProvisioningComplete

    if ($repair -or (Test-HamdFoodsProvisioningStage -State $managedState -Stage 'MigrationDeployment')) {
      $stage = 'PreMigrationBackup'
      Invoke-InstalledBackup -Verify
      Write-HamdFoodsProvisioningEvent -Path $provisioningLogPath -Stage $stage -Status 'PASS'
    }
  }

  if ($repair -or -not (Test-HamdFoodsProvisioningStage -State $managedState -Stage 'MigrationDeployment')) {
    $stage = 'MigrationDeployment'
    Import-HamdFoodsEnvironment -EnvironmentFile $configPath
    Invoke-InstalledMigrations
    Write-HamdFoodsProvisioningEvent -Path $provisioningLogPath -Stage $stage -Status 'PASS'
    Complete-HamdFoodsProvisioningStage -State $managedState -Stage $stage
  }

  if ($repair -or -not (Test-HamdFoodsProvisioningStage -State $managedState -Stage 'SeedExecution')) {
    $stage = 'SeedExecution'
    Invoke-InstalledSeed
    Write-HamdFoodsProvisioningEvent -Path $provisioningLogPath -Stage $stage -Status 'PASS'
    Complete-HamdFoodsProvisioningStage -State $managedState -Stage $stage
  }

  if (-not (Test-HamdFoodsProvisioningStage -State $managedState -Stage 'AdministratorBootstrap')) {
    $stage = 'AdministratorBootstrap'
    Invoke-AdminBootstrap
    Write-HamdFoodsProvisioningEvent -Path $provisioningLogPath -Stage $stage -Status 'PASS'
    Complete-HamdFoodsProvisioningStage -State $managedState -Stage $stage
  }

  $stage = 'TaskRegistration'
  Register-ApplicationTask
  if ($InstallBackupTask) { Register-BackupTask } else { Unregister-ScheduledTask -TaskName $BackupTaskName -Confirm:$false -ErrorAction SilentlyContinue }
  Write-HamdFoodsProvisioningEvent -Path $provisioningLogPath -Stage $stage -Status 'PASS'
  Complete-HamdFoodsProvisioningStage -State $managedState -Stage $stage

  $stage = 'RuntimeStartup'
  Start-ScheduledTask -TaskName $TaskName
  Wait-Healthy
  Write-HamdFoodsProvisioningEvent -Path $provisioningLogPath -Stage $stage -Status 'PASS'
  Complete-HamdFoodsProvisioningStage -State $managedState -Stage $stage

  if ($fresh -or -not $repair) {
    $stage = 'InitialBackupVerification'
    Invoke-InstalledBackup -Verify
    Write-HamdFoodsProvisioningEvent -Path $provisioningLogPath -Stage $stage -Status 'PASS'
  }
  $managedState.ProvisioningComplete = $true
  Save-HamdFoodsProvisioningState -State $managedState
  Write-HamdFoodsProvisioningEvent -Path $provisioningLogPath -Stage 'Installation' -Status 'PASS'
  Write-Output 'Hamd Foods ERP installation verification passed.'
} catch {
  $failure = $_
  $sensitiveValues = @($postgresPassword) + @(Get-HamdFoodsSensitiveValues)
  if ($null -ne $secrets) { $sensitiveValues += @($secrets.DatabasePassword, $secrets.AuthSecret) }
  try {
    if (Test-Path -LiteralPath $installerLogRoot -PathType Container) {
      Write-HamdFoodsProvisioningFailure -Path $provisioningLogPath -Stage $stage -ErrorRecord $failure -SensitiveValues $sensitiveValues
    }
  } catch {
    Write-Warning 'The non-secret provisioning failure log could not be written.'
  }
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($fresh) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $BackupTaskName -Confirm:$false -ErrorAction SilentlyContinue
  }
  if ($fresh -and $createdDatabase -and $createdRole) {
    Write-Warning 'Application database resources were created before setup failed and were preserved for safe operator review.'
  }
  throw $failure
} finally {
  $postgresPassword = $null
  $secrets = $null
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:BOOTSTRAP_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:BOOTSTRAP_ADMIN_EMAIL -ErrorAction SilentlyContinue
  Remove-Item Env:BOOTSTRAP_ADMIN_NAME -ErrorAction SilentlyContinue
}
}

function Find-SupportedPostgres {
  $root = Join-Path (Get-HamdFoodsNativeProgramFiles) 'PostgreSQL'
  $detected = if (Test-Path -LiteralPath $root) { @(Get-ChildItem -LiteralPath $root -Directory | Where-Object Name -Match '^\d+$') } else { @() }
  $unsupported = @($detected | Where-Object {
    if ($_.Name -eq '16') { return $false }
    $candidateBin = Join-Path $_.FullName 'bin'
    $candidateService = Get-Service -Name "postgresql-x64-$($_.Name)" -ErrorAction SilentlyContinue
    return $candidateService -or (Test-Path -LiteralPath (Join-Path $candidateBin 'postgres.exe') -PathType Leaf)
  })
  if ($unsupported.Count) { throw "Unsupported/conflicting usable PostgreSQL major detected: $($unsupported.Name -join ', ')." }
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

function Stop-HamdFoodsManagedRuntime {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
  $expectedNode = Join-Path $AppRoot 'runtime\node\node.exe'
  foreach ($listener in $listeners) {
    if ($listener.LocalAddress -notin @('127.0.0.1', '::1')) { throw "Port $Port has a non-loopback listener; setup will not terminate it." }
    $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    if (-not $process) {
      if (-not (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object OwningProcess -eq $listener.OwningProcess)) { continue }
      throw "Port $Port owner could not be identity-checked; setup will not terminate it."
    }
    if (
      $process.ProcessName -ne 'node' -or
      -not [StringComparer]::OrdinalIgnoreCase.Equals([string]$process.Path, $expectedNode)
    ) { throw "Port $Port is not owned by the exact installed runtime; setup will not terminate it." }
    $taskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe'
    $termination = Start-Process -FilePath $taskkill -ArgumentList @('/PID', [string]$listener.OwningProcess, '/T', '/F') -WindowStyle Hidden -Wait -PassThru
    if ($termination.ExitCode -ne 0 -and (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object OwningProcess -eq $listener.OwningProcess)) {
      throw "Native termination failed for exact installed runtime PID $($listener.OwningProcess)."
    }
  }
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  while ((Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 250
  }
  if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { throw "Port $Port remains occupied after stopping the exact installed runtime." }
}

function Remove-HamdFoodsScheduledTasks {
  Stop-HamdFoodsManagedRuntime
  Stop-ScheduledTask -TaskName $BackupTaskName -ErrorAction SilentlyContinue
  foreach ($name in @($TaskName, $BackupTaskName)) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  }
}

function Assert-PostgresLoopback {
  param([hashtable]$Postgres)
  Invoke-HamdFoodsNativeProcess -FilePath $Postgres.PgIsReady -WorkingDirectory $Postgres.Bin -Arguments @('-h', '127.0.0.1', '-p', '5432', '-t', '5') | Out-Null
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
  Stop-HamdFoodsManagedRuntime
}

function ConvertFrom-SecureValue {
  param([Security.SecureString]$Value)
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Get-PostgresAdministratorPassword {
  if ($Drill -and $env:HAMDFOODS_AUTOMATED_INSTALL_DRILL -eq '1') { return '' }
  $credential = Get-Credential -UserName 'postgres' -Message 'Enter the PostgreSQL 16 administrator password. It is used only for provisioning and is not stored.'
  if ($null -eq $credential) { throw 'PostgreSQL credential entry was cancelled.' }
  return ConvertFrom-SecureValue $credential.Password
}

function New-RandomHex {
  param([int]$Bytes)
  $buffer = [byte[]]::new($Bytes)
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($buffer) }
  finally { $generator.Dispose() }
  return ([BitConverter]::ToString($buffer) -replace '-', '').ToLowerInvariant()
}

function New-InstallationSecrets { return @{ DatabasePassword = (New-RandomHex 32); AuthSecret = (New-RandomHex 48) } }

function Get-HamdFoodsInstalledVersion {
  $manifestPath = Join-Path $AppRoot 'installer-manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Installer payload manifest is missing.' }
  $manifest = [IO.File]::ReadAllText($manifestPath) | ConvertFrom-Json
  if ($manifest.applicationVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Installer payload version is invalid.' }
  return $manifest.applicationVersion
}

function Test-HamdFoodsRestrictedPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  $item = Get-Item -LiteralPath $Path -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
  $allowed = @('S-1-5-18', 'S-1-5-32-544')
  foreach ($rule in (Get-Acl -LiteralPath $Path).Access) {
    try { $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value }
    catch { return $false }
    if ($sid -notin $allowed -or $rule.AccessControlType -ne 'Allow') { return $false }
  }
  return $true
}

function New-HamdFoodsProvisioningState {
  return [pscustomobject]@{
    SchemaVersion = 1
    InstallationId = $installationId
    ApplicationVersion = Get-HamdFoodsInstalledVersion
    AppRoot = $AppRoot
    DataRoot = $DataRoot
    DatabaseName = $DatabaseName
    RoleName = $RoleName
    ResourcesCreated = [pscustomobject]@{ Database = $false; Role = $false }
    CompletedStages = @()
    ProvisioningComplete = $false
  }
}

function Save-HamdFoodsProvisioningState {
  param([Parameter(Mandatory = $true)]$State)
  $temporary = Join-Path $stateRoot ("provisioning-state-{0}.tmp" -f [Guid]::NewGuid().ToString('N'))
  try {
    [IO.File]::WriteAllText($temporary, (($State | ConvertTo-Json -Depth 5) + "`r`n"), [Text.UTF8Encoding]::new($false))
    Protect-HamdFoodsPath -Path $temporary
    Move-Item -LiteralPath $temporary -Destination $statePath -Force
    Protect-HamdFoodsPath -Path $statePath
  } finally { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
}

function Read-HamdFoodsProvisioningState {
  try { return ([IO.File]::ReadAllText($statePath) | ConvertFrom-Json) }
  catch { throw 'Installer provisioning state is invalid.' }
}

function Assert-HamdFoodsProvisioningState {
  param([Parameter(Mandatory = $true)]$State, [switch]$RequireResources)
  $knownStages = @('ConfigurationWrite', 'MigrationDeployment', 'SeedExecution', 'AdministratorBootstrap', 'TaskRegistration', 'RuntimeStartup')
  $completedStages = @($State.CompletedStages)
  $stagesValid = $completedStages.Count -le $knownStages.Count
  for ($index = 0; $stagesValid -and $index -lt $completedStages.Count; $index++) {
    $stagesValid = $completedStages[$index] -is [string] -and $completedStages[$index] -ceq $knownStages[$index]
  }
  if (
    $State.SchemaVersion -ne 1 -or
    $State.InstallationId -ne $installationId -or
    $State.ApplicationVersion -notmatch '^\d+\.\d+\.\d+$' -or
    $State.AppRoot -ne $AppRoot -or
    $State.DataRoot -ne $DataRoot -or
    $State.DatabaseName -ne $DatabaseName -or
    $State.RoleName -ne $RoleName -or
    $null -eq $State.ResourcesCreated -or
    $State.ResourcesCreated.Database -isnot [bool] -or
    $State.ResourcesCreated.Role -isnot [bool] -or
    $State.ProvisioningComplete -isnot [bool] -or
    -not $stagesValid -or
    ($State.ProvisioningComplete -and $completedStages.Count -ne $knownStages.Count) -or
    ($RequireResources -and (-not $State.ResourcesCreated.Database -or -not $State.ResourcesCreated.Role))
  ) { throw 'Installer provisioning state does not match these managed resources.' }
}

function Test-HamdFoodsProvisioningStage {
  param([Parameter(Mandatory = $true)]$State, [Parameter(Mandatory = $true)][string]$Stage)
  return $Stage -in @($State.CompletedStages)
}

function Complete-HamdFoodsProvisioningStage {
  param([Parameter(Mandatory = $true)]$State, [Parameter(Mandatory = $true)][string]$Stage)
  if ($Stage -notin @($State.CompletedStages)) { $State.CompletedStages = @($State.CompletedStages) + $Stage }
  Save-HamdFoodsProvisioningState -State $State
}

function Import-HamdFoodsLegacyProvisioningState {
  $log = [IO.File]::ReadAllText($provisioningLogPath)
  foreach ($required in @('DatabaseProvisioning', 'ConfigurationWrite', 'MigrationDeployment')) {
    if ($log -notmatch "(?m)^.*\[$required\] PASS(?:\s|$)") {
      throw 'Existing configuration lacks complete legacy installer provenance; setup will not claim its PostgreSQL resources.'
    }
  }
  $state = New-HamdFoodsProvisioningState
  $state.ResourcesCreated.Database = $true
  $state.ResourcesCreated.Role = $true
  $knownStages = @('ConfigurationWrite', 'MigrationDeployment', 'SeedExecution', 'AdministratorBootstrap', 'TaskRegistration', 'RuntimeStartup')
  $state.CompletedStages = @($knownStages | Where-Object { $log -match "(?m)^.*\[$_\] PASS(?:\s|$)" })
  $state.ProvisioningComplete = $log -match '(?m)^.*\[Installation\] PASS(?:\s|$)'
  Save-HamdFoodsProvisioningState -State $state
  Write-HamdFoodsProvisioningEvent -Path $provisioningLogPath -Stage 'LegacyStateAdoption' -Status 'PASS' -Message 'Protected Phase 32 provisioning evidence was converted to explicit non-secret state.'
  return $state
}

function Invoke-Psql {
  param([hashtable]$Postgres, [string]$Password, [string]$Database = 'postgres', [string]$File, [string]$Command)
  $env:PGPASSWORD = $Password
  try {
    $arguments = @('--no-password', '-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', '5432', '-U', 'postgres', '-d', $Database)
    if ($File) { $arguments += @('-f', $File) } else { $arguments += @('-Atc', $Command) }
    $result = Invoke-HamdFoodsNativeProcess -FilePath $Postgres.Psql -WorkingDirectory $Postgres.Bin -Arguments $arguments -SensitiveValues @($Password)
    return $result.SafeStdOut.Trim()
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

function Register-PreSuppliedLicense {
  # Phase 33 software licensing: optionally stages a vendor-signed .lic file
  # supplied at install time, using the exact same protected-config pattern
  # as .env.production. Absence is never a failure -- the application enters
  # its own SETUP_GRACE period and a license can always be activated later
  # from Administration -> License. A staging failure is logged and
  # swallowed rather than aborting the installation, because licensing must
  # never block setup from completing (see the Phase 33 design, Section 8).
  if ([string]::IsNullOrWhiteSpace($LicenseFile)) { return }
  $licenseDestination = Join-Path $configDirectory 'license.lic'
  try {
    if (Test-Path -LiteralPath $licenseDestination -PathType Leaf) {
      Write-HamdFoodsProvisioningEvent -Path $provisioningLogPath -Stage 'LicenseStaging' -Status 'PASS' -Message 'A license already exists; the supplied file was not applied.'
      return
    }
    if (-not (Test-Path -LiteralPath $LicenseFile -PathType Leaf)) {
      Write-HamdFoodsProvisioningEvent -Path $provisioningLogPath -Stage 'LicenseStaging' -Status 'FAIL' -Message 'The supplied license file could not be found.'
      return
    }
    Copy-Item -LiteralPath $LicenseFile -Destination $licenseDestination -Force
    Protect-HamdFoodsPath -Path $licenseDestination
    Write-HamdFoodsProvisioningEvent -Path $provisioningLogPath -Stage 'LicenseStaging' -Status 'PASS'
  } catch {
    $safeMessage = ConvertTo-HamdFoodsSafeLogText -Text $_.Exception.Message -SensitiveValues (Get-HamdFoodsSensitiveValues)
    Write-HamdFoodsProvisioningEvent -Path $provisioningLogPath -Stage 'LicenseStaging' -Status 'FAIL' -Message $safeMessage
  }
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
  Invoke-HamdFoodsNode -AppRoot $AppRoot -Arguments @($cli, 'migrate', 'deploy', '--config', (Join-Path $AppRoot 'operations\prisma.config.mjs')) -SensitiveValues (Get-HamdFoodsSensitiveValues)
}

function Invoke-InstalledSeed {
  Invoke-HamdFoodsNode -AppRoot $AppRoot -Arguments @('--conditions=react-server', (Join-Path $AppRoot 'operations\seed-all.mjs')) -SensitiveValues (Get-HamdFoodsSensitiveValues)
}

function Invoke-AdminBootstrap {
  $automatedDrill = $Drill -and $env:HAMDFOODS_AUTOMATED_INSTALL_DRILL -eq '1'
  if ($automatedDrill) {
    $name = $env:HAMDFOODS_DRILL_ADMIN_NAME
    $email = $env:HAMDFOODS_DRILL_ADMIN_EMAIL
    $password = $env:HAMDFOODS_DRILL_ADMIN_PASSWORD
    $confirmation = $password
  } else {
    $name = Read-Host 'Initial SUPER_ADMIN name'
    $email = Read-Host 'Initial SUPER_ADMIN email'
    $first = Read-Host 'Initial SUPER_ADMIN password (8-128 characters)' -AsSecureString
    $second = Read-Host 'Confirm initial SUPER_ADMIN password' -AsSecureString
    $password = ConvertFrom-SecureValue $first
    $confirmation = ConvertFrom-SecureValue $second
  }
  try {
    if ([string]::IsNullOrWhiteSpace($name) -or $email -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') { throw 'A valid administrator name and email are required.' }
    if ($password.Length -lt 8 -or $password.Length -gt 128 -or $password -cne $confirmation) { throw 'Administrator passwords are invalid or do not match.' }
    $env:BOOTSTRAP_ADMIN_NAME = $name.Trim()
    $env:BOOTSTRAP_ADMIN_EMAIL = $email.Trim().ToLowerInvariant()
    $env:BOOTSTRAP_ADMIN_PASSWORD = $password
    Invoke-HamdFoodsNode -AppRoot $AppRoot -Arguments @('--conditions=react-server', (Join-Path $AppRoot 'operations\bootstrap-super-admin.mjs')) -SensitiveValues (Get-HamdFoodsSensitiveValues)
  } finally {
    $password = $null; $confirmation = $null
    Remove-Item Env:BOOTSTRAP_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:BOOTSTRAP_ADMIN_EMAIL -ErrorAction SilentlyContinue
    Remove-Item Env:BOOTSTRAP_ADMIN_NAME -ErrorAction SilentlyContinue
    Remove-Item Env:HAMDFOODS_DRILL_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:HAMDFOODS_DRILL_ADMIN_EMAIL -ErrorAction SilentlyContinue
    Remove-Item Env:HAMDFOODS_DRILL_ADMIN_NAME -ErrorAction SilentlyContinue
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
  Invoke-HamdFoodsNode -AppRoot $AppRoot -Arguments @((Join-Path $AppRoot 'operations\database-backup.mjs'), 'create') -SensitiveValues (Get-HamdFoodsSensitiveValues)
  if ($Verify) {
    $manifest = Get-ChildItem -LiteralPath $backupRoot -Filter '*.manifest.json' -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if (-not $manifest) { throw 'Backup verification could not locate a completed manifest.' }
    $identifier = $manifest.Name.Substring(0, $manifest.Name.Length - '.manifest.json'.Length)
    Invoke-HamdFoodsNode -AppRoot $AppRoot -Arguments @((Join-Path $AppRoot 'operations\database-backup.mjs'), 'verify', $identifier) -SensitiveValues (Get-HamdFoodsSensitiveValues)
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

try { Invoke-HamdFoodsSetup }
catch {
  $safeMessage = ConvertTo-HamdFoodsSafeLogText -Text $_.Exception.Message -SensitiveValues (Get-HamdFoodsSensitiveValues)
  Write-Error $safeMessage
  exit 1
}
