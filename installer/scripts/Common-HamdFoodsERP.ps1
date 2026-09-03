[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-HamdFoodsManagedPath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Expected
  )

  if ($Path.StartsWith("\\") -or -not [System.IO.Path]::IsPathRooted($Path)) {
    throw "Managed paths must be absolute paths on a local drive."
  }
  $actualFull = [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
  $expectedFull = [System.IO.Path]::GetFullPath($Expected).TrimEnd('\')
  if (-not $actualFull.Equals($expectedFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "The requested path is not an approved Hamd Foods ERP managed path."
  }
  if (Test-Path -LiteralPath $actualFull) {
    $item = Get-Item -LiteralPath $actualFull -Force
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Managed paths cannot be reparse points."
    }
  }
  return $actualFull
}

function Import-HamdFoodsEnvironment {
  param([Parameter(Mandatory = $true)][string]$EnvironmentFile)

  if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) {
    throw "Protected production configuration is missing."
  }
  foreach ($line in [System.IO.File]::ReadAllLines($EnvironmentFile, [System.Text.Encoding]::UTF8)) {
    if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) { continue }
    $separator = $line.IndexOf('=')
    if ($separator -lt 1) { throw "Protected production configuration has an invalid entry." }
    $name = $line.Substring(0, $separator).Trim()
    if ($name -notmatch '^[A-Z][A-Z0-9_]*$') { throw "Protected production configuration has an invalid name." }
    [Environment]::SetEnvironmentVariable($name, $line.Substring($separator + 1), 'Process')
  }
}

function Invoke-HamdFoodsNode {
  param(
    [Parameter(Mandatory = $true)][string]$AppRoot,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  $node = Join-Path $AppRoot "runtime\node\node.exe"
  if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw "Bundled Node runtime is missing." }
  & $node @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Installed operation failed with exit code $LASTEXITCODE." }
}

function Protect-HamdFoodsPath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [switch]$Container
  )

  $icacls = Join-Path $env:SystemRoot "System32\icacls.exe"
  $grants = if ($Container) { @("*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F") } else { @("*S-1-5-18:F", "*S-1-5-32-544:F") }
  & $icacls $Path /inheritance:r /grant:r @grants | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not apply the required protected ACL." }

  $acl = Get-Acl -LiteralPath $Path
  if (-not $acl.AreAccessRulesProtected) { throw "ACL inheritance remains enabled." }
  $allowed = @('S-1-5-18', 'S-1-5-32-544')
  foreach ($rule in $acl.Access) {
    $sid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
    if ($sid -notin $allowed -or $rule.AccessControlType -ne 'Allow') {
      throw "Protected ACL contains an unexpected principal or rule."
    }
  }
}

function Test-HamdFoodsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
