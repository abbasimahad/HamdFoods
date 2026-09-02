[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$taskName = "HamdFoodsERP"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$runner = Join-Path $repositoryRoot "scripts\windows\run-production.ps1"
$environmentPath = Join-Path $repositoryRoot ".env.production"

if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) {
  throw ".env.production is required before the startup task can be installed."
}
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) {
  throw "Production runner script is missing."
}

$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$runner`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments -WorkingDirectory $repositoryRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 0)
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Output "Installed scheduled task $taskName. Protect .env.production so only Administrators and SYSTEM can read it."
