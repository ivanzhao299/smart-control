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
$repoScript = 'D:\smart-control\scripts\deploy-from-ci.ps1'
$bootstrapScript = 'C:\ProgramData\Anksen\smart-control-deploy.ps1'
$script = if (Test-Path $repoScript) { $repoScript } else { $bootstrapScript }

if (-not (Test-Path $script)) {
  throw "No GK9000 deployment script is installed: $script"
}

$arguments = @{
  Commit = $Commit
  ProjectRoot = 'D:\smart-control'
}
if ($Action -eq 'gk9000-verify') {
  $arguments.VerifyOnly = $true
}

& $script @arguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
