# Installs the FFmpeg Windows essentials build used for media compatibility.
# The source is linked by ffmpeg.org. Pin the release and verify its published
# SHA-256 before extraction so deployments are reproducible and fail closed.
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
$version = '8.1.2'
$zip = Join-Path $downloadRoot "ffmpeg-$version-essentials_build.zip"
$stage = Join-Path $downloadRoot 'ffmpeg-stage'
New-Item -ItemType Directory -Force -Path $downloadRoot | Out-Null
Remove-Item -Recurse -Force -Path $stage -ErrorAction SilentlyContinue

$url = "https://github.com/GyanD/codexffmpeg/releases/download/$version/ffmpeg-$version-essentials_build.zip"
$expected = 'DB580001CAA24AC104C8CB856CD113A87B0A443F7BDF47D8C12B1D740584A2EC'
Remove-Item -Force -Path $zip -ErrorAction SilentlyContinue
Write-Host "Downloading FFmpeg Windows essentials build $version..."
$savedErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& curl.exe -fsSL --retry 5 --retry-all-errors --retry-delay 5 --connect-timeout 20 --max-time 1200 --output $zip $url
$curlExitCode = $LASTEXITCODE
$ErrorActionPreference = $savedErrorActionPreference
if ($curlExitCode -ne 0) { throw "FFmpeg download failed with curl exit code $curlExitCode." }
$actual = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash
if ($actual -ne $expected) { throw "FFmpeg archive SHA-256 mismatch. Expected $expected, got $actual." }

Expand-Archive -Path $zip -DestinationPath $stage -Force
$found = Get-ChildItem -Path $stage -Filter ffmpeg.exe -File -Recurse | Select-Object -First 1
if (-not $found) { throw 'ffmpeg.exe was not found in the verified archive.' }
$sourceBin = $found.Directory.FullName
New-Item -ItemType Directory -Force -Path $bin | Out-Null
Copy-Item -Path (Join-Path $sourceBin '*') -Destination $bin -Recurse -Force
if (-not (Test-Path $ffprobe)) { throw 'ffprobe.exe was not installed.' }
Write-Host "FFmpeg installed and verified: $ffmpeg"
