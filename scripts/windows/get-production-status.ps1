[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$taskName = "HamdFoodsERP"
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($null -eq $task) {
  Write-Output "Scheduled task $taskName is not installed."
  exit 1
}

$info = Get-ScheduledTaskInfo -TaskName $taskName
[PSCustomObject]@{
  TaskName = $taskName
  State = $task.State
  LastRunTime = $info.LastRunTime
  LastTaskResult = $info.LastTaskResult
  NextRunTime = $info.NextRunTime
} | Format-List
Write-Output "Recent logs: Get-Content C:\ProgramData\HamdFoodsERP\logs\application.log -Tail 100"
