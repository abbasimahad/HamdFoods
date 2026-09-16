[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ManifestPath,
  [Parameter(Mandatory = $true)][string]$SignaturePath,
  [Parameter(Mandatory = $true)][string]$PayloadRoot,
  [Parameter(Mandatory = $true)][string]$DestinationZip
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Phase 35 L1: every path arrives as its own bound parameter (safe argv,
# never PowerShell script text built via string interpolation), so a path
# containing a quote or other special character cannot break out of a
# hand-built -Command string -- this is vendor-only release tooling
# (scripts/updates/sign-update-package.ts), never reachable by the running
# application, but it is the signing tool for the update trust root and is
# held to the same array-form-arguments standard as every installed script.
Compress-Archive -Path $ManifestPath, $SignaturePath, $PayloadRoot -DestinationPath $DestinationZip -Force
