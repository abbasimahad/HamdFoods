[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$AppRoot,
  [Parameter(Mandatory = $true)][string]$DataRoot,
  [switch]$Drill
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common-HamdFoodsERP.ps1')

if (-not (Test-HamdFoodsAdministrator)) {
  $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $arguments = @(
    '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath,
    '-AppRoot', $AppRoot, '-DataRoot', $DataRoot
  )
  if ($Drill) { $arguments += '-Drill' }
  $arguments = $arguments | ForEach-Object { ConvertTo-HamdFoodsWindowsCommandLineArgument -Value $_ }
  $elevated = Start-Process -FilePath $powershell -ArgumentList ($arguments -join ' ') -Verb RunAs -WindowStyle Normal -Wait -PassThru
  exit $elevated.ExitCode
}

function ConvertFrom-RecoverySecureString {
  param([Parameter(Mandatory = $true)][Security.SecureString]$Value)
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Invoke-RecoveryProgram {
  param([Parameter(Mandatory = $true)][object]$Request)
  $node = Join-Path $AppRoot 'runtime\node\node.exe'
  $entry = Join-Path $AppRoot 'operations\account-recovery.mjs'
  if (-not (Test-Path -LiteralPath $node -PathType Leaf) -or -not (Test-Path -LiteralPath $entry -PathType Leaf)) {
    throw 'The installed account recovery runtime is incomplete.'
  }
  $process = [Diagnostics.Process]::new()
  try {
    $process.StartInfo = [Diagnostics.ProcessStartInfo]::new()
    $process.StartInfo.FileName = $node
    $process.StartInfo.WorkingDirectory = $AppRoot
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = $true
    $process.StartInfo.RedirectStandardInput = $true
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    $nodeArguments = @('--conditions=react-server', $entry) | ForEach-Object {
      ConvertTo-HamdFoodsWindowsCommandLineArgument -Value $_
    }
    $process.StartInfo.Arguments = $nodeArguments -join ' '
    if (-not $process.Start()) { throw 'The account recovery runtime could not start.' }
    $process.StandardInput.WriteLine(($Request | ConvertTo-Json -Compress))
    $process.StandardInput.Close()
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
      $safe = ConvertTo-HamdFoodsSafeLogText -Text $stderr -SensitiveValues (Get-HamdFoodsSensitiveValues)
      throw "Account recovery was rejected. $safe"
    }
    return $stdout | ConvertFrom-Json
  } finally { $process.Dispose() }
}

$password = $null
$confirmation = $null
$email = $null
$request = $null
try {
  $folder = if ($Drill) { 'HamdFoodsERP-InstallDrill' } else { 'HamdFoodsERP' }
  $expectedAppRoot = Join-Path (Get-HamdFoodsNativeProgramFiles) $folder
  $expectedDataRoot = Join-Path 'C:\ProgramData' $folder
  $AppRoot = Assert-HamdFoodsManagedPath -Path $AppRoot -Expected $expectedAppRoot
  $DataRoot = Assert-HamdFoodsManagedPath -Path $DataRoot -Expected $expectedDataRoot
  Import-HamdFoodsEnvironment -EnvironmentFile (Join-Path $DataRoot 'config\.env.production')

  Write-Host 'HamdFoods ERP Account Recovery' -ForegroundColor Cyan
  Write-Host 'Local Windows Administrator access confirmed. Credentials are never shown or logged.'
  $listed = Invoke-RecoveryProgram -Request @{ action = 'list' }
  $accounts = @($listed.accounts)
  if (-not $accounts.Count) { throw 'No active administrative ERP account is available for recovery.' }
  for ($index = 0; $index -lt $accounts.Count; $index++) {
    $account = $accounts[$index]
    Write-Host ("[{0}] {1} | {2} | {3} | {4}" -f ($index + 1), $account.displayName, $account.loginEmail, ($account.roleCodes -join ', '), $account.status)
  }
  $selection = 0
  if (-not [int]::TryParse((Read-Host 'Select account number'), [ref]$selection) -or $selection -lt 1 -or $selection -gt $accounts.Count) {
    throw 'The account selection is invalid.'
  }
  $target = $accounts[$selection - 1]
  $choice = Read-Host 'Choose recovery action: [1] Change Login Email [2] Reset Password [3] Change Both'
  if ($choice -notin @('1', '2', '3')) { throw 'The recovery action is invalid.' }

  $request = @{ action = 'recover'; userId = $target.id }
  if ($choice -in @('1', '3')) {
    $email = (Read-Host 'New login email').Trim().ToLowerInvariant()
    if ($email -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') { throw 'Enter a valid login email.' }
    $request.loginEmail = $email
  }
  if ($choice -in @('2', '3')) {
    $first = Read-Host 'New password' -AsSecureString
    $second = Read-Host 'Confirm new password' -AsSecureString
    $password = ConvertFrom-RecoverySecureString -Value $first
    $confirmation = ConvertFrom-RecoverySecureString -Value $second
    if ($password.Length -lt 8 -or $password.Length -gt 128 -or $password -cne $confirmation) {
      throw 'Passwords must match and contain 8 to 128 characters.'
    }
    $request.password = $password
    $request.confirmedPassword = $confirmation
  }
  $result = Invoke-RecoveryProgram -Request $request
  if ($result.status -ne 'updated') { throw 'Account recovery did not complete.' }
  Write-Host 'Account recovery completed. All existing ERP sessions for this account were revoked.' -ForegroundColor Green
  [void](Read-Host 'Press Enter to close')
} catch {
  $sensitiveValues = @($password, $confirmation) + @(Get-HamdFoodsSensitiveValues)
  $safe = ConvertTo-HamdFoodsSafeLogText -Text $_.Exception.Message -SensitiveValues $sensitiveValues
  Write-Error $safe
  [void](Read-Host 'Press Enter to close')
  exit 1
} finally {
  $password = $null
  $confirmation = $null
  $email = $null
  $request = $null
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:BETTER_AUTH_SECRET -ErrorAction SilentlyContinue
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
