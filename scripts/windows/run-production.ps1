[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$environmentPath = Join-Path $repositoryRoot ".env.production"
$runtimePath = Join-Path $repositoryRoot ".next\standalone\server.js"
$programDataRoot = if ($env:ProgramData) { $env:ProgramData } else { "C:\ProgramData" }
$logDirectory = Join-Path $programDataRoot "HamdFoodsERP\logs"
$logPath = Join-Path $logDirectory "application.log"
$runtimeHelper = Join-Path $PSScriptRoot "production-runtime.ps1"

if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) {
  throw ".env.production is required. Copy .env.production.example and protect the real file."
}
if (-not (Test-Path -LiteralPath $runtimePath -PathType Leaf)) {
  throw "Standalone runtime is missing. Run pnpm production:build first."
}
if (-not (Test-Path -LiteralPath $runtimeHelper -PathType Leaf)) {
  throw "Production runtime helper is missing."
}

. $runtimeHelper
$node = Resolve-ProductionNodeExe
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
Set-Location -LiteralPath $repositoryRoot
$env:NODE_ENV = "production"

$startupValidator = Get-ProductionStartupValidator -RepositoryRoot $repositoryRoot
& $node $startupValidator.TsxCli $startupValidator.Script start *>> $logPath
exit $LASTEXITCODE
