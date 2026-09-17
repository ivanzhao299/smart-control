# Shared by browser startup and cache recovery. Never use a personal browser profile.
function Get-PlayerProfilePath {
  param([ValidateRange(1,3)][int]$Slot, [string]$LocalAppData = $env:LOCALAPPDATA)
  if ([string]::IsNullOrWhiteSpace($LocalAppData)) { throw 'LOCALAPPDATA is unavailable.' }
  return (Join-Path $LocalAppData ("smart-control-player-slot" + $Slot))
}

function Clear-PlayerProfileCache {
  param([ValidateRange(1,3)][int]$Slot, [string]$LocalAppData = $env:LOCALAPPDATA)
  $profile = Get-PlayerProfilePath -Slot $Slot -LocalAppData $LocalAppData
  if (-not (Test-Path -LiteralPath $profile)) { return }
  # Reject links/junctions anywhere beneath LOCALAPPDATA, including nested cache
  # entries. Preserve all cookies, Local/Session Storage, IndexedDB and credentials.
  foreach ($relative in @('Default\Service Worker', 'Default\Cache', 'Default\Code Cache', 'Default\GPUCache', 'GPUCache', 'ShaderCache', 'GrShaderCache')) {
    $target = Join-Path $profile $relative
    if (-not (Test-Path -LiteralPath $target)) { continue }
    $ancestor = Get-Item -LiteralPath $target -Force -ErrorAction Stop
    while ($ancestor -and $ancestor.FullName -ne [IO.Path]::GetFullPath($LocalAppData)) {
      if ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing linked cache path: $target" }
      $ancestor = $ancestor.Parent
    }
    $linked = Get-ChildItem -LiteralPath $target -Recurse -Force -ErrorAction Stop |
      Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint } | Select-Object -First 1
    if ($linked) { throw "Refusing linked cache content: $target" }
    Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
    Write-Host ("  cleared slot " + $Slot + ": " + $relative) -ForegroundColor Gray
  }
}
