[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$taskName = "HamdFoodsERP"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$runner = Join-Path $repositoryRoot "scripts\windows\run-production.ps1"
$runtimeHelper = Join-Path $repositoryRoot "scripts\windows\production-runtime.ps1"
$environmentPath = Join-Path $repositoryRoot ".env.production"
$runtimePath = Join-Path $repositoryRoot ".next\standalone\server.js"
$programDataRoot = if ($env:ProgramData) { $env:ProgramData } else { "C:\ProgramData" }
$applicationDataRoot = Join-Path $programDataRoot "HamdFoodsERP"

if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) {
  throw ".env.production is required before the startup task can be installed."
}
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) {
  throw "Production runner script is missing."
}
if (-not (Test-Path -LiteralPath $runtimeHelper -PathType Leaf)) {
  throw "Production runtime helper is missing."
}
if (-not (Test-Path -LiteralPath $runtimePath -PathType Leaf)) {
  throw "Standalone runtime is missing. Run pnpm production:build before installing the task."
}

. $runtimeHelper
$node = Resolve-ProductionNodeExe
Assert-ProductionStartupConfiguration -NodeExe $node -RepositoryRoot $repositoryRoot

foreach ($directory in @($applicationDataRoot, (Join-Path $applicationDataRoot "logs"), (Join-Path $applicationDataRoot "backups"))) {
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
}

& icacls.exe $applicationDataRoot /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Failed to protect the HamdFoodsERP application-data directory."
}
& icacls.exe $environmentPath /inheritance:r /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F" | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Failed to protect .env.production."
}

$arguments = "-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments -WorkingDirectory $repositoryRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 0)
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Output "Installed scheduled task $taskName. Protect .env.production so only Administrators and SYSTEM can read it."
