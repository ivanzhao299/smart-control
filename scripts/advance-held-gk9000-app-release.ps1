# Advance a held, already-migrated release across the Android artifact-only commit
# produced by android-build.yml. Default mode is read-only. This script never
# accepts application, schema, dependency, deployment-tool or runtime-data changes.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$Commit,
  [Parameter(Mandatory=$true)][string]$TaskSnapshot,
  [Parameter(Mandatory=$true)][string]$MigrationReceipt,
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = 'D:\smart-control'
$recoveryRoot = 'D:\smart-control-backups\migration-recovery'
$lockPath = Join-Path $env:ProgramData 'Anksen\smart-control-deploy.lock'
$lockStream = $null
$allowedPaths = @(
  'deploy/assets/app/manifest.json',
  'deploy/assets/app/smart-control-latest.apk'
)

if ($env:COMPUTERNAME -ne 'GK9000') { throw 'GK9000 only.' }
$hold = Join-Path $root 'RELEASE_HOLD'
if (-not (Test-Path -LiteralPath $hold -PathType Leaf)) { throw 'No held release exists.' }

$snapshotPath = [IO.Path]::GetFullPath($TaskSnapshot)
$logsRoot = [IO.Path]::GetFullPath((Join-Path $root 'logs')).TrimEnd('\')
if ((Split-Path -Parent $snapshotPath).TrimEnd('\') -ne $logsRoot -or
    -not (Test-Path -LiteralPath $snapshotPath -PathType Leaf)) {
  throw 'Task snapshot must be an existing file in the production logs directory.'
}
$receiptPath = [IO.Path]::GetFullPath($MigrationReceipt)
$recoveryPath = [IO.Path]::GetFullPath($recoveryRoot).TrimEnd('\')
if (-not $receiptPath.StartsWith($recoveryPath + '\', [StringComparison]::OrdinalIgnoreCase) -or
    -not (Test-Path -LiteralPath $receiptPath -PathType Leaf)) {
  throw 'Migration receipt must be an existing file in the recovery directory.'
}
$receipt = [IO.File]::ReadAllText($receiptPath) | ConvertFrom-Json
if ($receipt.version -ne 1 -or $receipt.kind -ne 'gk9000-migration-complete' -or
    $receipt.candidateRevision -notmatch '^[a-f0-9]{40}$' -or
    $receipt.productionActivated -ne $false) {
  throw 'Invalid migration receipt.'
}
$previousCandidate = [string]$receipt.candidateRevision

try {
  $lockStream = [IO.File]::Open(
    $lockPath,
    [IO.FileMode]::OpenOrCreate,
    [IO.FileAccess]::ReadWrite,
    [IO.FileShare]::None
  )
  & git -C $root fetch --prune origin main
  if ($LASTEXITCODE -ne 0) { throw 'Unable to fetch main.' }
  $head = (& git -C $root rev-parse HEAD).Trim()
  $main = (& git -C $root rev-parse origin/main).Trim()
  if ($head -ne $previousCandidate -or $main -ne $Commit) {
    throw 'Held checkout, receipt candidate and fetched main do not match the requested advance.'
  }
  & git -C $root merge-base --is-ancestor $previousCandidate $Commit
  if ($LASTEXITCODE -ne 0) { throw 'Requested app artifact is not a descendant of the migrated candidate.' }
  $dirty = & git -C $root status --porcelain --untracked-files=no
  if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Tracked checkout changes prevent held release advance.' }
  $changedPaths = @(& git -C $root diff --name-only $previousCandidate $Commit --)
  if ($LASTEXITCODE -ne 0 -or $changedPaths.Count -ne $allowedPaths.Count -or
      @(Compare-Object $allowedPaths $changedPaths).Count -ne 0) {
    throw 'Held release advance permits only the Android manifest and APK.'
  }
  & (Join-Path $root 'scripts\assert-gk9000-writers-stopped.ps1') -ProjectRoot $root | Out-Null
  if (-not $?) { throw 'Held release is not fully isolated.' }
  & node (Join-Path $root 'backend\scripts\verify-gk9000-migration-receipt.cjs') `
    $receiptPath $previousCandidate $root
  if ($LASTEXITCODE -ne 0) { throw 'Original migration recovery bundle verification failed.' }
  if (-not $Apply) {
    Write-Output 'Held Android artifact advance preflight passed. No files or data were changed.'
    return
  }

  & git -C $root merge --ff-only $Commit
  if ($LASTEXITCODE -ne 0) { throw 'Unable to fast-forward to the Android artifact commit.' }
  & (Join-Path $root 'scripts\assert-gk9000-writers-stopped.ps1') -ProjectRoot $root | Out-Null
  if (-not $?) { throw 'Release isolation changed during held checkout advance.' }

  Push-Location (Join-Path $root 'backend')
  try {
    & node scripts\reconcile-app-release.cjs `
      --manifest ..\deploy\assets\app\manifest.json `
      --artifact ..\deploy\assets\app\smart-control-latest.apk
    if ($LASTEXITCODE -ne 0) { throw 'Android app release reconciliation failed.' }
  } finally {
    Pop-Location
  }

  $advancedReceiptPath = Join-Path (Split-Path -Parent $receiptPath) `
    ("migration-complete-advanced-{0}.json" -f $Commit)
  $advancedReceipt = [ordered]@{
    version = 1
    kind = 'gk9000-migration-complete'
    completedAt = [string]$receipt.completedAt
    sourceRevision = [string]$receipt.sourceRevision
    candidateRevision = $Commit
    databasePath = [string]$receipt.databasePath
    mediaRoot = [string]$receipt.mediaRoot
    rehearsalDirectory = [string]$receipt.rehearsalDirectory
    migrations = @($receipt.migrations)
    bundledMedia = $receipt.bundledMedia
    productionActivated = $false
    advancedAt = (Get-Date).ToUniversalTime().ToString('o')
    advancedFromCandidate = $previousCandidate
    allowedChangedPaths = $allowedPaths
  }
  if (Test-Path -LiteralPath $advancedReceiptPath -PathType Leaf) {
    $existing = [IO.File]::ReadAllText($advancedReceiptPath) | ConvertFrom-Json
    if ($existing.candidateRevision -ne $Commit -or
        $existing.advancedFromCandidate -ne $previousCandidate) {
      throw 'Existing advanced receipt does not match this recovery attempt.'
    }
  } else {
    $json = $advancedReceipt | ConvertTo-Json -Depth 8
    $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($json)
    $stream = [IO.File]::Open(
      $advancedReceiptPath,
      [IO.FileMode]::CreateNew,
      [IO.FileAccess]::Write,
      [IO.FileShare]::None
    )
    try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
  }
  & (Join-Path $root 'scripts\resume-gk9000-release.ps1') -Commit $Commit `
    -TaskSnapshot $snapshotPath -MigrationReceipt $advancedReceiptPath -Apply
  if ($LASTEXITCODE -ne 0) { throw 'Controlled activation of the advanced candidate failed.' }
  Write-Output ('Held Android artifact release activated from receipt: ' + $advancedReceiptPath)
} finally {
  if ($lockStream) { $lockStream.Dispose() }
}
