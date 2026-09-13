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
$script = if (Test-Path $repoScript) { $repoScript } else { $bootstrapScript }

if (-not (Test-Path $script)) {
  throw "No GK9000 deployment script is installed: $script"
}

# 清理可能被merge覆盖的未跟踪文件（2026-09-13 根因：GK9000上backend/data/video-binding.json未跟踪导致merge失败）
if ($Action -eq 'gk9000-deploy' -and (Test-Path $repoRoot)) {
  Push-Location $repoRoot
  try {
    $untrackedFiles = @(git status --porcelain --untracked-files=all 2>$null | Where-Object { $_ -match '^\?\?' } | ForEach-Object { $_.Substring(3).Trim() })
    if ($untrackedFiles.Count -gt 0) {
      Write-Output "Removing $($untrackedFiles.Count) untracked files that would be overwritten by merge: $($untrackedFiles -join ', ')"
      foreach ($relativeFile in $untrackedFiles) {
        $fullPath = Join-Path $repoRoot $relativeFile
        Remove-Item -Path $fullPath -Force -ErrorAction SilentlyContinue
      }
    }
  } finally {
    Pop-Location
  }
}

$arguments = @{
  Commit = $Commit
  ProjectRoot = $repoRoot
}
if ($Action -eq 'gk9000-verify') {
  $arguments.VerifyOnly = $true
}

& $script @arguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
