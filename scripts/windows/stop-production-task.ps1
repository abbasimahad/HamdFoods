[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$taskName = "HamdFoodsERP"
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
if ($task.State -ne "Running") {
  Write-Output "Scheduled task $taskName is not running."
  exit 0
}

Stop-ScheduledTask -TaskName $taskName
Write-Output "Stopped scheduled task $taskName."
