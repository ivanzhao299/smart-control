# Continue a release that is already isolated by suspend-gk9000-release.ps1.
# This is an explicit recovery path: it never removes RELEASE_HOLD without a
# verified migration receipt and successful candidate activation.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$Commit,
  [Parameter(Mandatory=$true)][string]$TaskSnapshot,
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = 'D:\smart-control'
$recoveryRoot = 'D:\smart-control-backups\migration-recovery'
$lockPath = Join-Path $env:ProgramData 'Anksen\smart-control-deploy.lock'
$lockStream = $null
if ($env:COMPUTERNAME -ne 'GK9000') { throw 'GK9000 only.' }
if (-not (Test-Path -LiteralPath (Join-Path $root 'RELEASE_HOLD') -PathType Leaf)) {
  throw 'No held release exists.'
}
$snapshotPath = [IO.Path]::GetFullPath($TaskSnapshot)
$logsRoot = [IO.Path]::GetFullPath((Join-Path $root 'logs')).TrimEnd('\')
if ((Split-Path -Parent $snapshotPath).TrimEnd('\') -ne $logsRoot -or
    -not (Test-Path -LiteralPath $snapshotPath -PathType Leaf)) {
  throw 'Task snapshot must be an existing file in the production logs directory.'
}
$snapshot = [IO.File]::ReadAllText($snapshotPath) | ConvertFrom-Json
if ($snapshot.Version -ne 1 -or $snapshot.SourceRevision -notmatch '^[a-f0-9]{40}$') {
  throw 'Invalid task snapshot.'
}

try {
  $lockStream = [System.IO.File]::Open(
    $lockPath,
    [System.IO.FileMode]::OpenOrCreate,
    [System.IO.FileAccess]::ReadWrite,
    [System.IO.FileShare]::None
  )
  $head = (& git -C $root rev-parse HEAD).Trim()
  $main = (& git -C $root rev-parse origin/main).Trim()
  if ($LASTEXITCODE -ne 0 -or $head -ne $Commit -or $main -ne $Commit) {
    throw 'Held checkout and fetched main must match the requested candidate.'
  }
  $dirty = & git -C $root status --porcelain --untracked-files=no
  if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Tracked checkout changes prevent reconciliation.' }
  & (Join-Path $root 'scripts\assert-gk9000-writers-stopped.ps1') -ProjectRoot $root | Out-Null
  if (-not $?) { throw 'Held release is not fully isolated.' }
  if (-not $Apply) {
    Write-Output 'Held release reconciliation preflight passed. No migration or activation was performed.'
    return
  }

  Push-Location (Join-Path $root 'backend')
  try {
    & pnpm.cmd install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'Locked backend dependency install failed.' }
    & pnpm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Backend candidate build failed.' }
    $previousPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      $migrationLines = @(& node scripts/run-gk9000-migrations.cjs $recoveryRoot $snapshot.SourceRevision 2>&1)
      $migrationExit = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousPreference
    }
    foreach ($line in $migrationLines) { Write-Output $line }
    if ($migrationExit -ne 0) { throw "Controlled database migration failed (exit $migrationExit)." }
  } finally {
    Pop-Location
  }
  $receiptLine = @($migrationLines | Where-Object { $_ -match '^Migration receipt \(not activation\): (.+)$' }) | Select-Object -Last 1
  if (-not $receiptLine) { throw 'Controlled migration returned no activation receipt.' }
  $receipt = ([regex]::Match([string]$receiptLine, '^Migration receipt \(not activation\): (.+)$')).Groups[1].Value.Trim()
  if (-not (Test-Path -LiteralPath $receipt -PathType Leaf)) { throw 'Migration receipt file is missing.' }

  & (Join-Path $root 'scripts\resume-gk9000-release.ps1') -Commit $Commit `
    -TaskSnapshot $snapshotPath -MigrationReceipt $receipt -Apply
  if ($LASTEXITCODE -ne 0) { throw "Controlled activation failed (exit $LASTEXITCODE)." }
  Write-Output ('Held release reconciled and activated from receipt: ' + $receipt)
} finally {
  if ($lockStream) { $lockStream.Dispose() }
}
