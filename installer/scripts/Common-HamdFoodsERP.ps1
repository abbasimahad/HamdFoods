[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-HamdFoodsNativeProgramFiles {
  $programFiles = if (-not [string]::IsNullOrWhiteSpace($env:ProgramW6432)) {
    $env:ProgramW6432
  } else {
    $env:ProgramFiles
  }
  if ([string]::IsNullOrWhiteSpace($programFiles) -or $programFiles.StartsWith("\\") -or -not [IO.Path]::IsPathRooted($programFiles)) {
    throw "The native Program Files directory is unavailable or unsafe."
  }
  return [IO.Path]::GetFullPath($programFiles).TrimEnd('\')
}

function ConvertTo-HamdFoodsSafeLogText {
  param(
    [AllowEmptyString()][string]$Text = '',
    [string[]]$SensitiveValues = @()
  )

  $safe = $Text -replace '[\r\n]+', ' '
  $safe = [regex]::Replace($safe, '(?i)\b(postgres(?:ql)?://)[^\s/@:]+:[^@\s/]+@', '$1[REDACTED]@')
  $safe = [regex]::Replace($safe, '(?i)["'']?(password|secret|token|better_auth_secret|bootstrap_admin_password)["'']?\s*[:=]\s*["'']?[^\s;,}"'']+', '$1=[REDACTED]')
  $safe = [regex]::Replace($safe, '(?i)\b[a-f0-9]{32,}\b', '[REDACTED]')
  foreach ($sensitive in @($SensitiveValues | Where-Object { -not [string]::IsNullOrEmpty($_) } | Sort-Object Length -Descending)) {
    if (-not [string]::IsNullOrEmpty($sensitive)) { $safe = $safe.Replace($sensitive, '[REDACTED]') }
  }
  if ($safe.Length -gt 1000) { $safe = $safe.Substring(0, 1000) }
  return $safe
}

function Write-HamdFoodsProvisioningEvent {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z][A-Za-z0-9]+$')][string]$Stage,
    [Parameter(Mandatory = $true)][ValidateSet('START', 'PASS', 'FAIL')][string]$Status,
    [AllowEmptyString()][string]$Message = '',
    [AllowEmptyString()][string]$ErrorType = '',
    [int]$ExitCode = 0,
    [string[]]$SensitiveValues = @()
  )

  $timestamp = [DateTime]::UtcNow.ToString('o')
  $line = "$timestamp [$Stage] $Status"
  if ($Status -eq 'FAIL') {
    $safeType = ConvertTo-HamdFoodsSafeLogText -Text $ErrorType -SensitiveValues $SensitiveValues
    $safeMessage = ConvertTo-HamdFoodsSafeLogText -Text $Message -SensitiveValues $SensitiveValues
    $line += " ExitCode=$ExitCode ErrorType=$safeType Message=$safeMessage"
  } elseif (-not [string]::IsNullOrWhiteSpace($Message)) {
    $line += " Message=$(ConvertTo-HamdFoodsSafeLogText -Text $Message -SensitiveValues $SensitiveValues)"
  }
  [IO.File]::AppendAllText($Path, "$line`r`n", [Text.UTF8Encoding]::new($false))
}

function Write-HamdFoodsProvisioningFailure {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Stage,
    [Parameter(Mandatory = $true)][Management.Automation.ErrorRecord]$ErrorRecord,
    [string[]]$SensitiveValues = @()
  )

  $exitCode = 1
  if ($null -ne $ErrorRecord.Exception.Data -and $ErrorRecord.Exception.Data.Contains('ExitCode')) {
    $candidate = 0
    if ([int]::TryParse($ErrorRecord.Exception.Data['ExitCode'].ToString(), [ref]$candidate)) { $exitCode = $candidate }
  }
  Write-HamdFoodsProvisioningEvent -Path $Path -Stage $Stage -Status 'FAIL' -Message $ErrorRecord.Exception.Message -ErrorType $ErrorRecord.Exception.GetType().FullName -ExitCode $exitCode -SensitiveValues $SensitiveValues
}

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

function Get-HamdFoodsSensitiveValues {
  return @(
    $env:DATABASE_URL,
    $env:BETTER_AUTH_SECRET,
    $env:PGPASSWORD,
    $env:BOOTSTRAP_ADMIN_PASSWORD
  ) | Where-Object { -not [string]::IsNullOrEmpty($_) }
}

function ConvertTo-HamdFoodsWindowsCommandLineArgument {
  param([AllowEmptyString()][Parameter(Mandatory = $true)][string]$Value)

  if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
  $result = [Text.StringBuilder]::new()
  [void]$result.Append('"')
  $backslashes = 0
  foreach ($character in $Value.ToCharArray()) {
    if ($character -eq '\') {
      $backslashes++
      continue
    }
    if ($character -eq '"') {
      [void]$result.Append(('\' * (($backslashes * 2) + 1)))
      [void]$result.Append('"')
    } else {
      if ($backslashes) { [void]$result.Append(('\' * $backslashes)) }
      [void]$result.Append($character)
    }
    $backslashes = 0
  }
  if ($backslashes) { [void]$result.Append(('\' * ($backslashes * 2))) }
  [void]$result.Append('"')
  return $result.ToString()
}

function Invoke-HamdFoodsNativeProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [string[]]$Arguments = @(),
    [string[]]$SensitiveValues = @()
  )

  if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) { throw 'Installed executable is missing.' }
  if (-not (Test-Path -LiteralPath $WorkingDirectory -PathType Container)) { throw 'Installed working directory is missing.' }
  $process = [Diagnostics.Process]::new()
  try {
    $process.StartInfo = [Diagnostics.ProcessStartInfo]::new()
    $process.StartInfo.FileName = [IO.Path]::GetFullPath($FilePath)
    $process.StartInfo.WorkingDirectory = [IO.Path]::GetFullPath($WorkingDirectory)
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = $true
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    $process.StartInfo.Arguments = (($Arguments | ForEach-Object { ConvertTo-HamdFoodsWindowsCommandLineArgument -Value $_ }) -join ' ')
    if (-not $process.Start()) { throw 'Installed process could not be started.' }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $stdoutText = $stdoutTask.GetAwaiter().GetResult()
    $stderrText = $stderrTask.GetAwaiter().GetResult()
    $safeStdout = ConvertTo-HamdFoodsSafeLogText -Text $stdoutText -SensitiveValues $SensitiveValues
    $safeStderr = ConvertTo-HamdFoodsSafeLogText -Text $stderrText -SensitiveValues $SensitiveValues
    if ($process.ExitCode -ne 0) {
      $detail = if (-not [string]::IsNullOrWhiteSpace($safeStderr)) { $safeStderr } elseif (-not [string]::IsNullOrWhiteSpace($safeStdout)) { $safeStdout } else { 'No output emitted.' }
      $name = [IO.Path]::GetFileName($FilePath)
      $exception = [InvalidOperationException]::new("Installed operation failed: Executable=$name ArgumentCount=$($Arguments.Count) ExitCode=$($process.ExitCode) Detail=$detail")
      $exception.Data['ExitCode'] = $process.ExitCode
      throw $exception
    }
    return [pscustomobject]@{ ExitCode = $process.ExitCode; SafeStdOut = $safeStdout; SafeStdErr = $safeStderr }
  } finally {
    $process.Dispose()
  }
}

function Invoke-HamdFoodsNode {
  param(
    [Parameter(Mandatory = $true)][string]$AppRoot,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [string[]]$SensitiveValues = @()
  )

  $node = Join-Path $AppRoot 'runtime\node\node.exe'
  if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw 'Bundled Node runtime is missing.' }
  $result = Invoke-HamdFoodsNativeProcess -FilePath $node -WorkingDirectory $AppRoot -Arguments $Arguments -SensitiveValues $SensitiveValues
  if (-not [string]::IsNullOrWhiteSpace($result.SafeStdOut)) { Write-Output $result.SafeStdOut }
  if (-not [string]::IsNullOrWhiteSpace($result.SafeStdErr)) { Write-Warning $result.SafeStdErr }
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
