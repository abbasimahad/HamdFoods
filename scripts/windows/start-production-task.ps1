[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$taskName = "HamdFoodsERP"
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
if ($task.State -eq "Running") {
  Write-Output "Scheduled task $taskName is already running."
  exit 0
}

Start-ScheduledTask -TaskName $taskName
Write-Output "Started scheduled task $taskName."
