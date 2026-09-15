[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('Protect', 'Unprotect')][string]$Mode
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Local-machine DPAPI bridge used by the Node.js licensing runtime to seal and
# read the small integrity key that authenticates license-state.json. Input
# is base64 on stdin, output is base64 on stdout. No plaintext ever appears
# in an argument, environment variable, or log line. The protected blob is
# tied to this machine (DataProtectionScope.LocalMachine): copying it to a
# different machine makes Unprotect fail, which is the intended behavior.

Add-Type -AssemblyName System.Security

$inputText = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($inputText)) { throw 'No input was provided on stdin.' }

try {
  $bytes = [Convert]::FromBase64String($inputText.Trim())
} catch {
  throw 'Input on stdin was not valid base64.'
}

$scope = [Security.Cryptography.DataProtectionScope]::LocalMachine
$resultBytes = if ($Mode -eq 'Protect') {
  [Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope)
} else {
  [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope)
}

[Console]::Out.Write([Convert]::ToBase64String($resultBytes))
