param([string]$ProfileScript = (Join-Path $PSScriptRoot '..\..\..\scripts\player-profile-path.ps1'))
$ErrorActionPreference = 'Stop'
. $ProfileScript
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('sc-player-cache-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
function Put-Fixture([string]$Relative) {
  $path = Join-Path $fixture $Relative
  New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
  [IO.File]::WriteAllText($path, 'synthetic-fixture-data')
}
try {
  foreach ($slot in @(1,2,3)) {
    foreach ($item in @('Default\Service Worker\CacheStorage\old', 'Default\Cache\old', 'Default\Code Cache\old', 'Default\GPUCache\old', 'GPUCache\old', 'ShaderCache\old', 'GrShaderCache\old', 'Default\Local Storage\credential', 'Default\Session Storage\credential', 'Default\Network\Cookies', 'Default\IndexedDB\data', 'Default\Preferences')) {
      Put-Fixture ("smart-control-player-slot$slot\$item")
    }
  }
  Put-Fixture 'Microsoft\Edge\User Data\Default\Cache\personal'
  Clear-PlayerProfileCache -Slot 1 -LocalAppData $fixture
  foreach ($item in @('Default\Service Worker', 'Default\Cache', 'Default\Code Cache', 'Default\GPUCache', 'GPUCache', 'ShaderCache', 'GrShaderCache')) {
    if (Test-Path -LiteralPath (Join-Path $fixture "smart-control-player-slot1\$item")) { throw "Cache retained: $item" }
  }
  foreach ($item in @('smart-control-player-slot1\Default\Local Storage\credential', 'smart-control-player-slot1\Default\Session Storage\credential', 'smart-control-player-slot1\Default\Network\Cookies', 'smart-control-player-slot1\Default\IndexedDB\data', 'smart-control-player-slot1\Default\Preferences', 'smart-control-player-slot2\Default\Cache\old', 'smart-control-player-slot3\Default\Cache\old', 'Microsoft\Edge\User Data\Default\Cache\personal')) {
    if ([IO.File]::ReadAllText((Join-Path $fixture $item)) -ne 'synthetic-fixture-data') { throw "Protected fixture modified: $item" }
  }
  # A junction escaping the cache allowlist must not erase its destination.
  $link = Join-Path $fixture 'smart-control-player-slot1\Default\Cache'
  $destination = Join-Path $fixture 'Microsoft\Edge\User Data\Default\Cache'
  New-Item -ItemType Junction -Path $link -Target $destination | Out-Null
  $rejected = $false
  try { Clear-PlayerProfileCache -Slot 1 -LocalAppData $fixture } catch { $rejected = $_.Exception.Message -like 'Refusing linked*' }
  [IO.Directory]::Delete($link)
  if (-not $rejected) { throw 'Junction cleanup was not rejected' }
  if (-not (Test-Path -LiteralPath (Join-Path $destination 'personal'))) { throw 'Junction destination was damaged' }
  Write-Output 'PASS: real PowerShell cache cleanup, credentials preserved, other profiles untouched, junction rejected.'
} finally {
  if ($link -and (Test-Path -LiteralPath $link) -and ((Get-Item -LiteralPath $link -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { [IO.Directory]::Delete($link) }
  Remove-Item -LiteralPath $fixture -Recurse -Force
}
