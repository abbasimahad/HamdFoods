[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PackagePath,
  [Parameter(Mandatory = $true)][string]$VerifierNode,
  [Parameter(Mandatory = $true)][string]$VerifierScript
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common-HamdFoodsERP.ps1')

# Read-only, side-effect-free verification of a .hfupdate package: opens
# the zip, extracts ONLY manifest.json and manifest.sig (nothing from
# payload/ is ever touched here), and hands their raw bytes to the bundled
# Node verifier for Ed25519 signature verification (Windows PowerShell has
# no native Ed25519 support). Safe to run against the currently-active
# release's own process, since nothing here mutates any release directory,
# the database, or the Scheduled Task. Outputs the verifier's JSON verdict
# on stdout unchanged.

Add-Type -AssemblyName System.IO.Compression.FileSystem

if (-not (Test-Path -LiteralPath $PackagePath -PathType Leaf)) { throw 'Update package file is missing.' }

# Every failure below this point -- including a corrupt or non-zip upload,
# which [IO.Compression.ZipFile]::OpenRead throws a terminating
# InvalidDataException for -- must still produce the same {"valid":false,
# "reason":...} JSON verdict on stdout that the caller (verifyUpdatePackageFile
# in verify-update-package-file.ts) expects for every outcome. An uncaught
# exception here would exit with no stdout, which the caller correctly
# treats as its own distinct "verification could not run" failure rather
# than a user-facing "this package is invalid" message.
try {
  $archive = [IO.Compression.ZipFile]::OpenRead($PackagePath)
  try {
    $manifestEntry = $archive.Entries | Where-Object { $_.FullName -eq 'manifest.json' } | Select-Object -First 1
    $signatureEntry = $archive.Entries | Where-Object { $_.FullName -eq 'manifest.sig' } | Select-Object -First 1
    if (-not $manifestEntry -or -not $signatureEntry) {
      Write-Output '{"valid":false,"reason":"Package is missing manifest.json or manifest.sig."}'
      exit 1
    }
    if ($manifestEntry.Length -gt 2097152 -or $signatureEntry.Length -gt 2000) {
      Write-Output '{"valid":false,"reason":"manifest.json or manifest.sig is unexpectedly large."}'
      exit 1
    }

    function Read-ZipEntryText {
      param([IO.Compression.ZipArchiveEntry]$Entry)
      $stream = $Entry.Open()
      try {
        $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::UTF8)
        try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
      } finally { $stream.Dispose() }
    }

    $manifestJson = Read-ZipEntryText -Entry $manifestEntry
    $signatureBase64 = (Read-ZipEntryText -Entry $signatureEntry).Trim()
  } finally {
    $archive.Dispose()
  }
} catch {
  Write-Output '{"valid":false,"reason":"The uploaded update package is invalid or unreadable."}'
  exit 1
}

$request = @{ manifestJson = $manifestJson; signatureBase64 = $signatureBase64 } | ConvertTo-Json -Compress

$process = [Diagnostics.Process]::new()
try {
  $process.StartInfo = [Diagnostics.ProcessStartInfo]::new()
  $process.StartInfo.FileName = $VerifierNode
  $process.StartInfo.WorkingDirectory = Split-Path -Parent $VerifierNode
  $process.StartInfo.UseShellExecute = $false
  $process.StartInfo.CreateNoWindow = $true
  $process.StartInfo.RedirectStandardInput = $true
  $process.StartInfo.RedirectStandardOutput = $true
  $process.StartInfo.RedirectStandardError = $true
  $process.StartInfo.Arguments = (@($VerifierScript, 'verify-manifest') | ForEach-Object { ConvertTo-HamdFoodsWindowsCommandLineArgument -Value $_ }) -join ' '
  if (-not $process.Start()) { throw 'The update verifier could not start.' }
  $process.StandardInput.Write($request)
  $process.StandardInput.Close()
  $stdout = $process.StandardOutput.ReadToEnd()
  $process.WaitForExit()
  Write-Output $stdout.Trim()
  exit $process.ExitCode
} finally {
  $process.Dispose()
}
