param(
  [Parameter(Mandatory=$true)][string]$Job,
  [string]$MaxExe = 'C:\Program Files\Autodesk\3ds Max 2024\3dsmaxbatch.exe',
  [string]$SourceId = 'jinhu-park',
  [switch]$InspectOnly
)
$ErrorActionPreference = 'Stop'
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw 'An Intel/AMD Windows x64 worker is required.' }
if (-not (Test-Path -LiteralPath $MaxExe)) { throw 'Install and activate compatible 3ds Max from Autodesk first.' }
$inputRoot = Join-Path (Resolve-Path -LiteralPath $Job).Path 'worker-input'
if (-not (Test-Path -LiteralPath (Join-Path $inputRoot 'scene.max'))) { throw 'worker-input/scene.max is missing' }
$plugins = Get-ChildItem -LiteralPath (Split-Path $MaxExe) -Recurse -Filter 'vrender*.dlr' -ErrorAction SilentlyContinue
if (-not $plugins) { throw 'V-Ray for this 3ds Max version was not found. Install compatible V-Ray before loading this scene.' }
if ($InspectOnly) {
  [pscustomobject]@{ Architecture='x64'; Max=$MaxExe; VrayPlugin=$plugins.FullName; ScenePresent=$true; LicenseVerified=$false }
  exit 0
}
$output = Join-Path (Resolve-Path -LiteralPath $Job).Path 'max-export'
if (Test-Path -LiteralPath $output) { throw 'max-export already exists. Use a new job copy to preserve previous results.' }
New-Item -ItemType Directory -Path $output | Out-Null
$env:TWIN_INPUT = $inputRoot
$env:TWIN_OUTPUT = $output
$env:TWIN_SOURCE_ID = $SourceId
try {
  & $MaxExe (Join-Path $PSScriptRoot 'max-export.py') -sceneFile (Join-Path $inputRoot 'scene.max') -listenerLog (Join-Path $output 'listener.log') -log (Join-Path $output 'max.log')
  if ($LASTEXITCODE -ne 0) { throw "3ds Max Batch failed with code $LASTEXITCODE; inspect max-export logs." }
  if (-not (Test-Path -LiteralPath (Join-Path $output 'scene.fbx'))) { throw 'No FBX produced; inspect logs.' }
  if (-not (Test-Path -LiteralPath (Join-Path $output 'export-report.json'))) { throw 'Export report missing.' }
  Write-Output "FBX created at $output. Material and opposite-camera visual review is still required."
} finally {
  Remove-Item Env:TWIN_INPUT, Env:TWIN_OUTPUT, Env:TWIN_SOURCE_ID -ErrorAction SilentlyContinue
}
