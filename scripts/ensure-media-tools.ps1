# Installs the FFmpeg Windows essentials build used for media compatibility.
# The source is linked by ffmpeg.org; the adjacent publisher SHA-256 is verified
# before extraction. Existing installations are a no-op.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'

$root = 'D:\smart-control-tools\ffmpeg'
$bin = Join-Path $root 'bin'
$ffmpeg = Join-Path $bin 'ffmpeg.exe'
$ffprobe = Join-Path $bin 'ffprobe.exe'
if ((Test-Path $ffmpeg) -and (Test-Path $ffprobe)) {
  Write-Host "FFmpeg already installed: $ffmpeg"
  exit 0
}

$downloadRoot = 'D:\smart-control-tools\downloads'
$zip = Join-Path $downloadRoot 'ffmpeg-release-essentials.zip'
$checksumFile = "$zip.sha256"
$stage = Join-Path $downloadRoot 'ffmpeg-stage'
New-Item -ItemType Directory -Force -Path $downloadRoot | Out-Null
Remove-Item -Recurse -Force -Path $stage -ErrorAction SilentlyContinue

$base = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
Write-Host 'Downloading FFmpeg Windows essentials build...'
Invoke-WebRequest -UseBasicParsing -Uri $base -OutFile $zip -TimeoutSec 600
Invoke-WebRequest -UseBasicParsing -Uri "$base.sha256" -OutFile $checksumFile -TimeoutSec 60
$checksumText = Get-Content -Raw $checksumFile
$match = [regex]::Match($checksumText, '(?i)\b[0-9a-f]{64}\b')
if (-not $match.Success) { throw 'Publisher checksum file did not contain a SHA-256 hash.' }
$actual = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash
if ($actual -ne $match.Value.ToUpperInvariant()) { throw 'FFmpeg archive SHA-256 mismatch.' }

Expand-Archive -Path $zip -DestinationPath $stage -Force
$found = Get-ChildItem -Path $stage -Filter ffmpeg.exe -File -Recurse | Select-Object -First 1
if (-not $found) { throw 'ffmpeg.exe was not found in the verified archive.' }
$sourceBin = $found.Directory.FullName
New-Item -ItemType Directory -Force -Path $bin | Out-Null
Copy-Item -Path (Join-Path $sourceBin '*') -Destination $bin -Recurse -Force
if (-not (Test-Path $ffprobe)) { throw 'ffprobe.exe was not installed.' }
Write-Host "FFmpeg installed and verified: $ffmpeg"
