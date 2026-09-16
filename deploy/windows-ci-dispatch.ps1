[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('gk9000-deploy', 'gk9000-verify')]
  [string]$Action,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{40}$')]
  [string]$Commit
)

$ErrorActionPreference = 'Stop'
$repoRoot = 'D:\smart-control'
$repoScript = Join-Path $repoRoot 'scripts\deploy-from-ci.ps1'
$bootstrapScript = 'C:\ProgramData\Anksen\smart-control-deploy.ps1'
$script = $null
$targetScript = $null

# A deploy must run the script from the requested commit, not the script that
# happened to be installed by the previous release. Fetching updates Git refs
# only; the versioned deploy script remains the sole owner of worktree changes.
if ($Action -eq 'gk9000-deploy' -and (Test-Path (Join-Path $repoRoot '.git'))) {
  $fetched = $false
  for ($attempt = 0; $attempt -lt 3; $attempt++) {
    & git -C $repoRoot fetch --prune origin main
    if ($LASTEXITCODE -eq 0) {
      $fetched = $true
      break
    }
    Start-Sleep -Seconds 3
  }
  if (-not $fetched) { throw 'Failed to fetch origin/main for deployment bootstrap.' }

  & git -C $repoRoot merge-base --is-ancestor $Commit origin/main
  if ($LASTEXITCODE -ne 0) { throw 'Requested deployment commit is not reachable from origin/main.' }

  $objectSpec = "${Commit}:scripts/deploy-from-ci.ps1"
  $sourceLines = @(& git -C $repoRoot show $objectSpec)
  if ($LASTEXITCODE -ne 0 -or $sourceLines.Count -eq 0) {
    throw 'Requested commit does not contain the deployment script.'
  }

  $targetScript = Join-Path 'C:\ProgramData\Anksen' ("smart-control-deploy-target-{0}-{1}.ps1" -f $Commit, [Guid]::NewGuid().ToString('N'))
  [IO.File]::WriteAllLines($targetScript, [string[]]$sourceLines, (New-Object Text.UTF8Encoding($false)))
  $tokens = $null
  $parseErrors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($targetScript, [ref]$tokens, [ref]$parseErrors) | Out-Null
  if ($parseErrors.Count -gt 0) {
    throw "Requested deployment script failed PowerShell parsing: $($parseErrors[0].Message)"
  }
  $script = $targetScript
} else {
  $script = if (Test-Path $repoScript) { $repoScript } else { $bootstrapScript }
}

if (-not (Test-Path $script)) {
  throw "No GK9000 deployment script is installed: $script"
}

$arguments = @{
  Commit = $Commit
  ProjectRoot = $repoRoot
}
if ($Action -eq 'gk9000-verify') {
  $arguments.VerifyOnly = $true
}

try {
  & $script @arguments
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  if ($targetScript -and (Test-Path -LiteralPath $targetScript)) {
    [IO.File]::Delete($targetScript)
  }
}
