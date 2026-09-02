[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$taskName = "HamdFoodsERP"
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($null -eq $task) {
  Write-Output "Scheduled task $taskName is not installed."
  exit 0
}

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Write-Output "Removed scheduled task $taskName."
