[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Commit,
  [string]$Repo = 'D:\smart-control',
  [string]$SubPath = 'frontend/public/park-ops/3d-twin',
  [string]$WebRel = 'frontend\dist\park-ops\3d-twin',
  [switch]$DryRun
)
# Dedicated, least-privilege receiver for the 3D twin subtree only.
# It does NOT migrate, build, restart, or touch anything outside park-ops/3d-twin.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$allowedExt = @('.html', '.js', '.css', '.json', '.webp', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.woff2', '.wasm', '.glb', '.md', '.gitignore')
$prefix = 'frontend/public/park-ops/3d-twin/'

Set-Location $Repo

# 1. Fetch so the requested commit is available (best effort; may already exist).
& git fetch origin --quiet 2>$null

# 2. Verify the commit exists.
& git cat-file -e "${Commit}^{commit}" 2>$null
if ($LASTEXITCODE -ne 0) { throw "commit not found: $Commit" }

# 3. Export ONLY the twin subtree to a temp dir (working tree / main untouched).
$tmp = Join-Path $env:TEMP ("twin-recv-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
$zip = Join-Path $tmp 'twin.zip'
& git archive --format=zip -o $zip $Commit -- $SubPath
if ($LASTEXITCODE -ne 0) { throw "git archive failed" }
Expand-Archive -Path $zip -DestinationPath $tmp -Force
$src = Join-Path $tmp ($SubPath -replace '/', '\')
if (-not (Test-Path $src)) { throw "commit contains no twin subtree: $SubPath" }

# 4. Enumerate and validate every file (path + extension whitelist).
$files = Get-ChildItem -Path $src -Recurse -File
$manifest = New-Object System.Collections.Generic.List[object]
foreach ($f in $files) {
  $rel = $f.FullName.Substring($src.Length).TrimStart('\') -replace '\\', '/'
  $logical = $prefix + $rel
  if (-not $logical.StartsWith($prefix)) { throw "path outside twin dir: $logical" }
  if ($rel -match '\.\.') { throw "path traversal blocked: $rel" }
  $ext = $f.Extension.ToLower()
  if ($allowedExt -notcontains $ext) { throw "extension not allowed: $rel ($ext)" }
  $manifest.Add([pscustomobject]@{ Rel = $rel; Bytes = $f.Length }) | Out-Null
}

$dest = Join-Path $Repo ($WebRel -replace '/', '\')
Write-Output ("TWIN-SYNC commit=" + $Commit + " files=" + $manifest.Count + " dryRun=" + [bool]$DryRun)
$manifest | ForEach-Object { Write-Output ("  + " + $_.Rel + " (" + $_.Bytes + " B)") }

if ($DryRun) {
  Write-Output 'DRY-RUN: no files written.'
} else {
  # 5. Copy validated files into the served dist tree (twin dir only).
  New-Item -ItemType Directory -Path $dest -Force | Out-Null
  foreach ($m in $manifest) {
    $target = Join-Path $dest ($m.Rel -replace '/', '\')
    $tdir = Split-Path $target -Parent
    New-Item -ItemType Directory -Path $tdir -Force | Out-Null
    Copy-Item -Path (Join-Path $src ($m.Rel -replace '/', '\')) -Destination $target -Force
  }
  # 6. Remove stale files inside the twin dir that are no longer in the manifest.
  $cur = Get-ChildItem -Path $dest -Recurse -File -ErrorAction SilentlyContinue
  foreach ($c in $cur) {
    $rel = $c.FullName.Substring($dest.Length).TrimStart('\') -replace '\\', '/'
    if (-not ($manifest.Rel -contains $rel)) {
      Write-Output ("  - stale removed: " + $rel)
      Remove-Item $c.FullName -Force
    }
  }
  Write-Output ("TWIN-SYNC DONE -> " + $dest)
}

Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
