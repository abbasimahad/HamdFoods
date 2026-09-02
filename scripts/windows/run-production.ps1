[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$environmentPath = Join-Path $repositoryRoot ".env.production"
$runtimePath = Join-Path $repositoryRoot ".next\standalone\server.js"
$programDataRoot = if ($env:ProgramData) { $env:ProgramData } else { "C:\ProgramData" }
$logDirectory = Join-Path $programDataRoot "HamdFoodsERP\logs"
$logPath = Join-Path $logDirectory "application.log"

if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) {
  throw ".env.production is required. Copy .env.production.example and protect the real file."
}
if (-not (Test-Path -LiteralPath $runtimePath -PathType Leaf)) {
  throw "Standalone runtime is missing. Run pnpm production:build first."
}

$node = Get-Command node.exe -ErrorAction Stop
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
Set-Location -LiteralPath $repositoryRoot
$env:NODE_ENV = "production"

& $node.Source "--env-file=$environmentPath" $runtimePath *>> $logPath
exit $LASTEXITCODE
