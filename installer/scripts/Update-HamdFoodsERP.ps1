[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$AppRoot,
  [Parameter(Mandatory = $true)][string]$DataRoot,
  [Parameter(Mandatory = $true)][string]$TaskName,
  [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$Port,
  [switch]$Drill
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common-HamdFoodsERP.ps1')

# Phase 34 secure update orchestrator. Runs only as the trigger-less SYSTEM
# HamdFoodsERP-Update Scheduled Task, armed by Administration -> Updates.
# It never receives an arbitrary filesystem path from that web action --
# only a controlled packageId/updateId via DataRoot\state\pending-update.json
# (ACL-protected like every other DataRoot\state file), and it independently
# re-verifies the staged release's integrity before doing anything
# irreversible (defense in depth).
#
# Stage order (Phase 34 design, Section 5), each individually idempotent on
# resume (Section 8): PackageVerified -> PayloadStaged -> RuntimeStopped ->
# RuntimeStopConfirmed -> BackupVerified -> MigrationApplied ->
# ReleaseActivated -> TaskStarted -> HealthVerified -> Complete, with
# AbortedBackupFailed / RolledBack / StoppedForRecovery as terminal failure
# outcomes. HamdFoodsERP remains stopped from RuntimeStopped through a
# confirmed-consistent outcome.

$expectedApp = if ($Drill) { 'C:\Program Files\HamdFoodsERP-InstallDrill' } else { 'C:\Program Files\HamdFoodsERP' }
$expectedData = if ($Drill) { 'C:\ProgramData\HamdFoodsERP-InstallDrill' } else { 'C:\ProgramData\HamdFoodsERP' }
$AppRoot = Assert-HamdFoodsManagedPath -Path $AppRoot -Expected $expectedApp
$DataRoot = Assert-HamdFoodsManagedPath -Path $DataRoot -Expected $expectedData

$stateRoot = Join-Path $DataRoot 'state'
$updatesRoot = Join-Path $stateRoot 'updates'
$pendingUpdatePath = Join-Path $stateRoot 'pending-update.json'
$logPath = Join-Path $DataRoot 'logs\update.log'
$nodeExe = Join-Path $AppRoot 'runtime\node\node.exe'
$orchestratorScript = Join-Path $AppRoot 'operations\update-orchestrator.mjs'

$STAGE_ORDER = @(
  'PackageVerified', 'PayloadStaged', 'RuntimeStopped', 'RuntimeStopConfirmed',
  'BackupVerified', 'MigrationApplied', 'ReleaseActivated', 'TaskStarted', 'HealthVerified'
)

function Write-UpdateLog {
  param([string]$Message)
  New-Item -ItemType Directory -Path (Split-Path -Parent $logPath) -Force | Out-Null
  $safe = ConvertTo-HamdFoodsSafeLogText -Text $Message -SensitiveValues (Get-HamdFoodsSensitiveValues)
  "[$([DateTimeOffset]::Now.ToString('O'))] $safe" | Out-File -LiteralPath $logPath -Append -Encoding utf8
}

function Invoke-Orchestrator {
  param([Parameter(Mandatory = $true)][string]$Subcommand, [Parameter(Mandatory = $true)][hashtable]$Request)
  $json = $Request | ConvertTo-Json -Compress -Depth 10
  $process = [Diagnostics.Process]::new()
  try {
    $process.StartInfo = [Diagnostics.ProcessStartInfo]::new()
    $process.StartInfo.FileName = $nodeExe
    $process.StartInfo.WorkingDirectory = $AppRoot
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = $true
    $process.StartInfo.RedirectStandardInput = $true
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    $process.StartInfo.Arguments = (@($orchestratorScript, $Subcommand) | ForEach-Object { ConvertTo-HamdFoodsWindowsCommandLineArgument -Value $_ }) -join ' '
    if (-not $process.Start()) { throw 'The update orchestrator could not start.' }
    $process.StandardInput.Write($json)
    $process.StandardInput.Close()
    $stdout = $process.StandardOutput.ReadToEnd()
    $process.WaitForExit()
    return ($stdout.Trim() | ConvertFrom-Json)
  } finally { $process.Dispose() }
}

function Read-CurrentUpdateState {
  param([string]$ScriptPath)
  return Invoke-Orchestrator -Subcommand 'state-read' -Request @{ dataRoot = $DataRoot; scriptPath = $ScriptPath }
}

function Save-UpdateState {
  param([string]$ScriptPath, [object]$State)
  $result = Invoke-Orchestrator -Subcommand 'state-write' -Request @{ dataRoot = $DataRoot; scriptPath = $ScriptPath; data = $State }
  if (-not $result.ok) { throw 'Update state could not be saved.' }
}

function Set-StageAndSave {
  param([string]$ScriptPath, [object]$State, [string]$Stage, [hashtable]$Patch = @{})
  $updated = $State.PSObject.Copy()
  foreach ($key in $Patch.Keys) { $updated | Add-Member -NotePropertyName $key -NotePropertyValue $Patch[$key] -Force }
  $updated.stage = $Stage
  $updated.updatedAt = [DateTimeOffset]::Now.ToString('o')
  Save-UpdateState -ScriptPath $ScriptPath -State $updated
  return $updated
}

function Test-StageReached {
  param([string]$Stage, [string]$CurrentStage)
  $terminal = @('Complete', 'AbortedBackupFailed', 'RolledBack', 'StoppedForRecovery')
  if ($CurrentStage -in $terminal) { return $true }
  return ($STAGE_ORDER.IndexOf($CurrentStage) -ge $STAGE_ORDER.IndexOf($Stage))
}

function Get-HamdFoodsCurrentVersion {
  $active = Resolve-HamdFoodsActiveRelease -AppRoot $AppRoot
  if ($active.Layered) { return $active.Version }
  $manifestPath = Join-Path $AppRoot 'installer-manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Installer payload manifest is missing.' }
  $manifest = [IO.File]::ReadAllText($manifestPath) | ConvertFrom-Json
  if ($manifest.applicationVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Installed application version is invalid.' }
  return $manifest.applicationVersion
}

function Invoke-LazyLayoutAdoption {
  param([string]$CurrentVersion)
  $pointerPath = Join-Path $AppRoot 'active-release.json'
  if (Test-Path -LiteralPath $pointerPath -PathType Leaf) { return }
  Write-UpdateLog "Adopting the versioned-release layout for the current flat installation ($CurrentVersion)."
  $releaseRoot = Join-Path $AppRoot "releases\$CurrentVersion"
  if (-not (Test-Path -LiteralPath $releaseRoot -PathType Container)) {
    New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
    foreach ($component in @('app', 'operations', 'runtime')) {
      $source = Join-Path $AppRoot $component
      if (Test-Path -LiteralPath $source -PathType Container) {
        Copy-Item -LiteralPath $source -Destination (Join-Path $releaseRoot $component) -Recurse -Force
      }
    }
  }
  Set-HamdFoodsActiveRelease -AppRoot $AppRoot -Version $CurrentVersion

  # The task, if already running, was launched against the pre-adoption
  # flat runtime\node\node.exe path. Restart it once now so the actually
  # running process is immediately synchronized with the layered release
  # path Resolve-HamdFoodsActiveRelease now returns -- otherwise the exact-
  # process-identity check in Stop-HamdFoodsManagedRuntimeForRelease would
  # correctly, but confusingly, refuse to recognize its own just-adopted
  # release as the owner of the currently listening process.
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task -and $task.State -eq 'Running') {
    Write-UpdateLog 'Restarting the runtime once to synchronize it with the newly adopted release layout.'
    # The running process was launched against the pre-adoption flat
    # runtime\node\node.exe path -- stop it by that exact identity, not the
    # newly layered one, and not a plain Stop-ScheduledTask (which stops
    # only the PowerShell launcher and can leave the Node child listening;
    # see Stop-HamdFoodsManagedRuntimeForRelease's own doc history).
    $flatNodeExe = Join-Path $AppRoot 'runtime\node\node.exe'
    Stop-HamdFoodsManagedRuntimeForRelease -TaskName $TaskName -Port $Port -ExpectedNodeExe $flatNodeExe
    Start-ScheduledTask -TaskName $TaskName
    if (-not (Wait-HamdFoodsHealthy -Port $Port)) {
      throw 'The runtime did not become healthy after synchronizing the adopted release layout.'
    }
  }
}

function Read-ManifestEntries {
  param([string]$PackagePath)
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($PackagePath)
  try {
    $manifestEntry = $archive.Entries | Where-Object { $_.FullName -eq 'manifest.json' } | Select-Object -First 1
    $signatureEntry = $archive.Entries | Where-Object { $_.FullName -eq 'manifest.sig' } | Select-Object -First 1
    if (-not $manifestEntry -or -not $signatureEntry) { throw 'Package is missing manifest.json or manifest.sig.' }
    if ($manifestEntry.Length -gt 2097152 -or $signatureEntry.Length -gt 2000) { throw 'Manifest entries are unexpectedly large.' }
    function Read-Text($entry) {
      $stream = $entry.Open()
      try { $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::UTF8); try { return $reader.ReadToEnd() } finally { $reader.Dispose() } }
      finally { $stream.Dispose() }
    }
    return [pscustomobject]@{ ManifestJson = (Read-Text $manifestEntry); SignatureBase64 = (Read-Text $signatureEntry).Trim() }
  } finally { $archive.Dispose() }
}

function Invoke-SecureExtraction {
  param([string]$PackagePath, [string]$DestinationRoot, [object]$VerifiedManifest)
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if (Test-Path -LiteralPath $DestinationRoot) { Remove-Item -LiteralPath $DestinationRoot -Recurse -Force }
  New-Item -ItemType Directory -Path $DestinationRoot -Force | Out-Null
  $destinationRootFull = [IO.Path]::GetFullPath($DestinationRoot)

  # Phase 34 design, Section 2 step 5 / Section 8's idempotent-resume table:
  # any failure below -- an unsafe/undeclared archive entry, or a post-
  # extraction hash/size mismatch -- must delete the entire staged release
  # directory before failing, never leave a partial or verified-bad release
  # sitting in AppRoot\releases\. A bare throw from either loop below would
  # otherwise leave exactly that lingering (confirmed via a real drill).
  try {
    $allowedPaths = @{}
    foreach ($file in $VerifiedManifest.files) { $allowedPaths[$file.path.ToLowerInvariant()] = $file }

    $archive = [IO.Compression.ZipFile]::OpenRead($PackagePath)
    try {
      foreach ($entry in $archive.Entries) {
        if ($entry.FullName -eq 'manifest.json' -or $entry.FullName -eq 'manifest.sig') { continue }
        if ([string]::IsNullOrEmpty($entry.Name)) { continue }
        # The zip format specifies forward-slash entry separators, but some
        # Windows zip tools (including Compress-Archive, confirmed via a real
        # drill) emit backslashes instead. Normalize before any safety check
        # or manifest lookup so validation is not fooled by either form.
        $entryPath = $entry.FullName -replace '\\', '/'
        if ($entryPath -notlike 'payload/*' -or $entryPath -match '\.\.') {
          throw "Unsafe archive entry rejected: $($entry.FullName)"
        }
        $normalized = $entryPath.ToLowerInvariant()
        if (-not $allowedPaths.ContainsKey($normalized)) {
          throw "Archive entry not declared in the verified manifest: $($entry.FullName)"
        }
        $relative = $entryPath.Substring('payload/'.Length) -replace '/', '\'
        $destinationPath = [IO.Path]::GetFullPath((Join-Path $DestinationRoot $relative))
        if (-not $destinationPath.StartsWith($destinationRootFull, [StringComparison]::OrdinalIgnoreCase)) {
          throw "Archive entry escapes the staging directory: $($entry.FullName)"
        }
        New-Item -ItemType Directory -Path (Split-Path -Parent $destinationPath) -Force | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destinationPath, $true)
      }
    } finally { $archive.Dispose() }

    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
      foreach ($file in $VerifiedManifest.files) {
        $relative = $file.path.Substring('payload/'.Length) -replace '/', '\'
        $extractedPath = Join-Path $DestinationRoot $relative
        if (-not (Test-Path -LiteralPath $extractedPath -PathType Leaf)) { throw "Declared file was not extracted: $($file.path)." }
        $bytes = [IO.File]::ReadAllBytes($extractedPath)
        if ($bytes.Length -ne $file.size) { throw "Size mismatch for $($file.path)." }
        $hash = ([BitConverter]::ToString($sha256.ComputeHash($bytes)) -replace '-', '').ToLowerInvariant()
        if ($hash -ne $file.sha256.ToLowerInvariant()) { throw "Hash mismatch for $($file.path)." }
      }
    } finally { $sha256.Dispose() }
  } catch {
    Remove-Item -LiteralPath $DestinationRoot -Recurse -Force -ErrorAction SilentlyContinue
    throw
  }
}

function Invoke-ReleaseMigrations {
  param([object]$Release)
  $cli = Join-Path $Release.OperationsDir 'node_modules\prisma\build\index.js'
  $config = Join-Path $Release.OperationsDir 'prisma.config.mjs'
  Invoke-HamdFoodsNativeProcess -FilePath $Release.NodeExe -WorkingDirectory $Release.OperationsDir -Arguments @($cli, 'migrate', 'deploy', '--config', $config) -SensitiveValues (Get-HamdFoodsSensitiveValues) | Out-Null
}

function Invoke-ReleaseBackup {
  param([object]$Release, [switch]$Verify, [string]$BackupId)
  $script = Join-Path $Release.OperationsDir 'database-backup.mjs'
  if ($Verify) {
    Invoke-HamdFoodsNativeProcess -FilePath $Release.NodeExe -WorkingDirectory $Release.OperationsDir -Arguments @($script, 'verify', $BackupId) -SensitiveValues (Get-HamdFoodsSensitiveValues) | Out-Null
  } else {
    Invoke-HamdFoodsNativeProcess -FilePath $Release.NodeExe -WorkingDirectory $Release.OperationsDir -Arguments @($script, 'create') -SensitiveValues (Get-HamdFoodsSensitiveValues) | Out-Null
    $backupRoot = Join-Path $DataRoot 'backups'
    $manifest = Get-ChildItem -LiteralPath $backupRoot -Filter '*.manifest.json' -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if (-not $manifest) { throw 'Backup creation did not produce a manifest.' }
    return $manifest.Name.Substring(0, $manifest.Name.Length - '.manifest.json'.Length)
  }
}

function Invoke-Update {
  Import-HamdFoodsEnvironment -EnvironmentFile (Join-Path $DataRoot 'config\.env.production')
  $env:NODE_ENV = 'production'
  New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
  Protect-HamdFoodsPath -Path $stateRoot -Container
  if (-not (Test-Path -LiteralPath $pendingUpdatePath -PathType Leaf)) {
    Write-UpdateLog 'No pending update is armed; nothing to do.'
    return
  }
  $pending = [IO.File]::ReadAllText($pendingUpdatePath) | ConvertFrom-Json
  if ($pending.packageId -notmatch '^[A-Za-z0-9_-]{8,128}$') { throw 'Pending update packageId is invalid.' }
  $packageId = $pending.packageId
  $updateId = $pending.updateId
  $packagePath = Join-Path $updatesRoot "$packageId.hfupdate"
  if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) { throw 'The staged update package is missing.' }

  $dpapiScript = Join-Path $AppRoot 'windows\Dpapi-HamdFoodsERP.ps1'
  $existing = Read-CurrentUpdateState -ScriptPath $dpapiScript

  $currentVersion = Get-HamdFoodsCurrentVersion
  Invoke-LazyLayoutAdoption -CurrentVersion $currentVersion
  $oldRelease = Resolve-HamdFoodsActiveRelease -AppRoot $AppRoot

  # Independent re-verification: the web action already verified this
  # package once, but the task never trusts that without checking again
  # itself (Phase 34 design, Section 10).
  $entries = Read-ManifestEntries -PackagePath $packagePath
  $verification = Invoke-Orchestrator -Subcommand 'verify-manifest' -Request @{ manifestJson = $entries.ManifestJson; signatureBase64 = $entries.SignatureBase64 }
  if (-not $verification.valid) { throw "Update package failed independent re-verification: $($verification.reason)" }
  $manifest = $verification.manifest
  if ($manifest.fromVersion -ne $currentVersion) {
    throw "Update package fromVersion ($($manifest.fromVersion)) does not match the currently active version ($currentVersion)."
  }

  $state = if ($existing.kind -eq 'ok' -and $existing.data.updateId -eq $updateId -and $existing.data.stage -notin @('Complete', 'AbortedBackupFailed', 'RolledBack', 'StoppedForRecovery')) {
    $existing.data
  } else {
    $fresh = [pscustomobject]@{
      schemaVersion = 1; updateId = $updateId; packageId = $packageId
      fromVersion = $manifest.fromVersion; toVersion = $manifest.toVersion
      stage = 'PackageVerified'; backupId = $null
      previousRelease = $manifest.fromVersion; targetRelease = $manifest.toVersion
      migrationCompleted = $false; migrationCompletedAt = $null
      activationCompleted = $false; activationCompletedAt = $null
      healthResult = 'pending'; healthCheckedAt = $null
      rollbackResult = 'not-attempted'; rollbackAt = $null
      createdAt = [DateTimeOffset]::Now.ToString('o'); updatedAt = [DateTimeOffset]::Now.ToString('o')
    }
    Save-UpdateState -ScriptPath $dpapiScript -State $fresh
    $fresh
  }

  $newReleaseRoot = Join-Path $AppRoot "releases\$($manifest.toVersion)"
  $newRelease = [pscustomobject]@{ ReleaseRoot = $newReleaseRoot; AppDir = (Join-Path $newReleaseRoot 'app'); OperationsDir = (Join-Path $newReleaseRoot 'operations'); NodeExe = (Join-Path $newReleaseRoot 'runtime\node\node.exe') }

  if (-not (Test-StageReached -Stage 'PayloadStaged' -CurrentStage $state.stage)) {
    Invoke-SecureExtraction -PackagePath $packagePath -DestinationRoot $newReleaseRoot -VerifiedManifest $manifest
    if (-not $manifest.nodeRuntimeIncluded) {
      # Every release directory must be self-contained (Phase 34 design,
      # Section 6) even when a specific update does not ship a new Node
      # runtime -- copy the currently active release's runtime\node\ into
      # the new release rather than leaving Resolve-HamdFoodsActiveRelease
      # (used by Run-HamdFoodsERP.ps1 on every future launch, not just this
      # update) needing to special-case "this release borrows another
      # release's runtime."
      $sourceRuntimeDir = Split-Path -Parent $oldRelease.NodeExe
      $targetRuntimeDir = Join-Path $newReleaseRoot 'runtime\node'
      New-Item -ItemType Directory -Path (Split-Path -Parent $targetRuntimeDir) -Force | Out-Null
      Copy-Item -LiteralPath $sourceRuntimeDir -Destination $targetRuntimeDir -Recurse -Force
    }
    $state = Set-StageAndSave -ScriptPath $dpapiScript -State $state -Stage 'PayloadStaged'
    Write-UpdateLog "Payload staged and verified for $($manifest.toVersion)."
  }

  if (-not (Test-StageReached -Stage 'RuntimeStopped' -CurrentStage $state.stage)) {
    Stop-HamdFoodsManagedRuntimeForRelease -TaskName $TaskName -Port $Port -ExpectedNodeExe $oldRelease.NodeExe
    $state = Set-StageAndSave -ScriptPath $dpapiScript -State $state -Stage 'RuntimeStopped'
    Write-UpdateLog 'Runtime stopped.'
  }

  if (-not (Test-StageReached -Stage 'RuntimeStopConfirmed' -CurrentStage $state.stage)) {
    if (-not (Test-HamdFoodsRuntimeStopped -TaskName $TaskName -Port $Port)) { throw 'Runtime stop could not be confirmed.' }
    $state = Set-StageAndSave -ScriptPath $dpapiScript -State $state -Stage 'RuntimeStopConfirmed'
    Write-UpdateLog 'Runtime stop confirmed.'
  }

  if (-not (Test-StageReached -Stage 'BackupVerified' -CurrentStage $state.stage)) {
    try {
      $backupId = Invoke-ReleaseBackup -Release $oldRelease
      Invoke-ReleaseBackup -Release $oldRelease -Verify -BackupId $backupId
      $state = Set-StageAndSave -ScriptPath $dpapiScript -State $state -Stage 'BackupVerified' -Patch @{ backupId = $backupId }
      Write-UpdateLog "Backup $backupId created and verified."
    } catch {
      Write-UpdateLog "Backup or verification failed: $($_.Exception.Message). Restarting the unchanged old runtime and aborting."
      Start-ScheduledTask -TaskName $TaskName
      [void](Wait-HamdFoodsHealthy -Port $Port)
      $state = Set-StageAndSave -ScriptPath $dpapiScript -State $state -Stage 'AbortedBackupFailed'
      return
    }
  }

  if (-not (Test-StageReached -Stage 'MigrationApplied' -CurrentStage $state.stage)) {
    try {
      Invoke-ReleaseMigrations -Release $newRelease
    } catch {
      Write-UpdateLog "Migration failed: $($_.Exception.Message). Leaving the task stopped for operator-assisted recovery."
      $state = Set-StageAndSave -ScriptPath $dpapiScript -State $state -Stage 'StoppedForRecovery' -Patch @{ rollbackResult = 'not-attempted' }
      return
    }
    $state = Set-StageAndSave -ScriptPath $dpapiScript -State $state -Stage 'MigrationApplied' -Patch @{ migrationCompleted = $true; migrationCompletedAt = [DateTimeOffset]::Now.ToString('o') }
    Write-UpdateLog 'Migration applied.'
  }

  if (-not (Test-StageReached -Stage 'ReleaseActivated' -CurrentStage $state.stage)) {
    Set-HamdFoodsActiveRelease -AppRoot $AppRoot -Version $manifest.toVersion
    $state = Set-StageAndSave -ScriptPath $dpapiScript -State $state -Stage 'ReleaseActivated' -Patch @{ activationCompleted = $true; activationCompletedAt = [DateTimeOffset]::Now.ToString('o') }
    Write-UpdateLog "Release $($manifest.toVersion) activated."
  }

  if (-not (Test-StageReached -Stage 'TaskStarted' -CurrentStage $state.stage)) {
    Start-ScheduledTask -TaskName $TaskName
    $state = Set-StageAndSave -ScriptPath $dpapiScript -State $state -Stage 'TaskStarted'
    Write-UpdateLog 'Task started on the new release.'
  }

  if (-not (Test-StageReached -Stage 'HealthVerified' -CurrentStage $state.stage)) {
    $healthy = Wait-HamdFoodsHealthy -Port $Port
    if ($healthy) {
      $state = Set-StageAndSave -ScriptPath $dpapiScript -State $state -Stage 'Complete' -Patch @{ healthResult = 'pass'; healthCheckedAt = [DateTimeOffset]::Now.ToString('o') }
      Write-UpdateLog "Update to $($manifest.toVersion) completed successfully."
      Remove-Item -LiteralPath $pendingUpdatePath -Force -ErrorAction SilentlyContinue
      return
    }

    Write-UpdateLog 'Health check failed after activation.'
    if (-not $manifest.previousVersionCompatibleWithNewSchema) {
      Write-UpdateLog 'Automatic rollback is prohibited by this update''s release contract; leaving the task stopped for forward recovery.'
      # A plain Stop-ScheduledTask can leave the Node child listening (the
      # same historical defect Stop-HamdFoodsManagedRuntimeForRelease
      # exists to fix) -- "left stopped" must mean the process is actually
      # gone, not just unmonitored.
      Stop-HamdFoodsManagedRuntimeForRelease -TaskName $TaskName -Port $Port -ExpectedNodeExe $newRelease.NodeExe
      $state = Set-StageAndSave -ScriptPath $dpapiScript -State $state -Stage 'StoppedForRecovery' -Patch @{ healthResult = 'fail'; healthCheckedAt = [DateTimeOffset]::Now.ToString('o'); rollbackResult = 'prohibited' }
      return
    }

    Write-UpdateLog 'Attempting automatic app-binary rollback (schema compatibility certified by this update).'
    Stop-HamdFoodsManagedRuntimeForRelease -TaskName $TaskName -Port $Port -ExpectedNodeExe $newRelease.NodeExe
    Set-HamdFoodsActiveRelease -AppRoot $AppRoot -Version $manifest.fromVersion
    Start-ScheduledTask -TaskName $TaskName
    $rolledBackHealthy = Wait-HamdFoodsHealthy -Port $Port
    if ($rolledBackHealthy) {
      $state = Set-StageAndSave -ScriptPath $dpapiScript -State $state -Stage 'RolledBack' -Patch @{ healthResult = 'fail'; healthCheckedAt = [DateTimeOffset]::Now.ToString('o'); rollbackResult = 'succeeded'; rollbackAt = [DateTimeOffset]::Now.ToString('o') }
      Write-UpdateLog 'Automatic rollback succeeded; the previous version is running against the new schema.'
      Remove-Item -LiteralPath $pendingUpdatePath -Force -ErrorAction SilentlyContinue
    } else {
      Stop-HamdFoodsManagedRuntimeForRelease -TaskName $TaskName -Port $Port -ExpectedNodeExe $oldRelease.NodeExe
      $state = Set-StageAndSave -ScriptPath $dpapiScript -State $state -Stage 'StoppedForRecovery' -Patch @{ healthResult = 'fail'; healthCheckedAt = [DateTimeOffset]::Now.ToString('o'); rollbackResult = 'failed'; rollbackAt = [DateTimeOffset]::Now.ToString('o') }
      Write-UpdateLog 'Automatic rollback also failed to reach a healthy state; the task is left stopped for operator-assisted recovery.'
    }
  }
}

try {
  Invoke-Update
} catch {
  $safeMessage = ConvertTo-HamdFoodsSafeLogText -Text $_.Exception.Message -SensitiveValues (Get-HamdFoodsSensitiveValues)
  Write-UpdateLog "Update failed: $safeMessage"
  Write-Error $safeMessage
  exit 1
}
