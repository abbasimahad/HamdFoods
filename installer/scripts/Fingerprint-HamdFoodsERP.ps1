[CmdletBinding()]
param(
  [string]$DataRoot = 'C:\ProgramData'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Emits "<MachineGuid>|<VolumeSerialNumber>" for the drive hosting DataRoot.
# Both components are durable, non-secret Windows identifiers already
# legitimately readable without elevation; the Node licensing runtime hashes
# them together into an opaque fingerprint. Neither raw value is treated as
# secret, but this script never logs or displays them beyond stdout.

$machineGuid = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid -ErrorAction Stop).MachineGuid
$driveLetter = [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($DataRoot)).TrimEnd('\')
$volume = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='$driveLetter'" -ErrorAction Stop
if (-not $volume) { throw "Could not resolve volume information for $driveLetter." }
$serial = [string]$volume.VolumeSerialNumber

if ([string]::IsNullOrWhiteSpace($machineGuid) -or [string]::IsNullOrWhiteSpace($serial)) {
  throw 'Machine identity components are unavailable.'
}

[Console]::Out.Write("$machineGuid|$serial")
