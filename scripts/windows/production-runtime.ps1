Set-StrictMode -Version Latest

function Resolve-ProductionNodeExe {
  [CmdletBinding()]
  param()

  $configuredNode = $env:NODE_EXE
  if ([string]::IsNullOrWhiteSpace($configuredNode)) {
    $configuredNode = [Environment]::GetEnvironmentVariable("NODE_EXE", "Machine")
  }

  if (-not [string]::IsNullOrWhiteSpace($configuredNode)) {
    $configuredNode = $configuredNode.Trim().Trim('"')
    if (-not (Test-AbsoluteWindowsPath -Value $configuredNode)) {
      throw "NODE_EXE must be an absolute path to the machine-accessible Node 24 executable."
    }
    return (Assert-Node24Executable -Candidate $configuredNode)
  }

  $candidates = [System.Collections.Generic.List[string]]::new()
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  if (-not [string]::IsNullOrWhiteSpace($machinePath)) {
    foreach ($entry in $machinePath.Split([System.IO.Path]::PathSeparator)) {
      $expandedEntry = [Environment]::ExpandEnvironmentVariables($entry.Trim().Trim('"'))
      if (Test-AbsoluteWindowsPath -Value $expandedEntry) {
        $candidates.Add((Join-Path $expandedEntry "node.exe"))
      }
    }
  }

  $programFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
  if (-not [string]::IsNullOrWhiteSpace($programFiles)) {
    $candidates.Add((Join-Path $programFiles "nodejs\node.exe"))
  }

  foreach ($candidate in $candidates | Select-Object -Unique) {
    try {
      return (Assert-Node24Executable -Candidate $candidate)
    } catch {
      continue
    }
  }

  throw "A machine-accessible Node.js 24 executable was not found. Install Node 24 machine-wide or set the machine NODE_EXE environment variable to an absolute path."
}

function Assert-Node24Executable {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)]
    [string] $Candidate
  )

  if (-not (Test-AbsoluteWindowsPath -Value $Candidate) -or -not (Test-Path -LiteralPath $Candidate -PathType Leaf)) {
    throw "Node executable was not found at the absolute path: $Candidate"
  }

  $resolved = (Resolve-Path -LiteralPath $Candidate).Path
  $result = Invoke-ProductionNodeProcess -NodeExe $resolved -Arguments @("--version")
  $version = $result.StandardOutput.Trim()
  if ($result.ExitCode -ne 0 -or $version -notmatch '^v24\.') {
    throw "Node executable must report major version 24: $resolved"
  }
  return $resolved
}

function Test-AbsoluteWindowsPath {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)]
    [string] $Value
  )

  return $Value -match '^(?:[A-Za-z]:\\|\\\\[^\\]+\\[^\\]+\\)'
}

function Invoke-ProductionNodeProcess {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)]
    [string] $NodeExe,
    [Parameter(Mandatory)]
    [string[]] $Arguments
  )

  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $NodeExe
  $startInfo.Arguments = (($Arguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }) -join ' ')
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = [System.Diagnostics.Process]::Start($startInfo)
  $standardOutput = $process.StandardOutput.ReadToEnd()
  $standardError = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  return [PSCustomObject]@{
    ExitCode = $process.ExitCode
    StandardOutput = $standardOutput
    StandardError = $standardError
  }
}

function Assert-ProductionStartupConfiguration {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)]
    [string] $NodeExe,
    [Parameter(Mandatory)]
    [string] $RepositoryRoot
  )

  $startupValidator = Get-ProductionStartupValidator -RepositoryRoot $RepositoryRoot
  $result = Invoke-ProductionNodeProcess -NodeExe $NodeExe -Arguments @($startupValidator.TsxCli, $startupValidator.Script, "validate")
  if (-not [string]::IsNullOrWhiteSpace($result.StandardOutput)) {
    Write-Output $result.StandardOutput.Trim()
  }
  if ($result.ExitCode -ne 0) {
    if (-not [string]::IsNullOrWhiteSpace($result.StandardError)) {
      Write-Output $result.StandardError.Trim()
    }
    throw "Production startup configuration validation failed; the server was not started."
  }
}

function Get-ProductionStartupValidator {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)]
    [string] $RepositoryRoot
  )

  $tsxCli = Join-Path $RepositoryRoot "node_modules\tsx\dist\cli.mjs"
  $validator = Join-Path $RepositoryRoot "scripts\production.ts"
  if (-not (Test-Path -LiteralPath $tsxCli -PathType Leaf)) {
    throw "Production startup validator dependencies are missing. Run pnpm install --frozen-lockfile."
  }
  if (-not (Test-Path -LiteralPath $validator -PathType Leaf)) {
    throw "Production startup validator is missing."
  }
  return [PSCustomObject]@{
    TsxCli = $tsxCli
    Script = $validator
  }
}
