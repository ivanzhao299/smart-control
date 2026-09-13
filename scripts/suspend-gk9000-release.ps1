# One-host release pause. Default is read-only; -Apply retains a hold on failure.
# Does not migrate, provision credentials, update code, or restart anything.
[CmdletBinding()]
param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = 'D:\smart-control'
if ($env:COMPUTERNAME -ne 'GK9000') { throw 'GK9000 only.' }
$taskNames = @('SmartControl-AutoUpdate', 'SmartControl-DailyBackup',
  'SmartControl-PlayerWatchdog', 'SmartControlBackend', 'SmartControlFrontend')
$tasks = @($taskNames | ForEach-Object { Get-ScheduledTask -TaskName $_ -ErrorAction Stop })
$processes = @(Get-CimInstance Win32_Process)
$listeners = @(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in @(3200,5173) })
$owners = @($listeners.OwningProcess | Sort-Object -Unique)
if ($owners.Count -ne 2 -or @($listeners.LocalPort | Sort-Object -Unique).Count -ne 2) {
  throw 'Expected two distinct service port owners; inspect manually.'
}
$daemonIds = @()
foreach ($owner in $owners) {
  $app = $processes | Where-Object { $_.ProcessId -eq $owner }
  $parent = $processes | Where-Object { $_.ProcessId -eq $app.ParentProcessId }
  if ($app.Name -ne 'node.exe' -or $app.CommandLine -notmatch 'ProcessContainer' -or
      $parent.Name -ne 'node.exe' -or $parent.CommandLine -notmatch '(?i)pm2.*Daemon\.js') {
    throw 'Service owner is not a verified PM2 child.'
  }
  $daemonIds += $parent.ProcessId
}
$pidFile = 'C:\Users\user\.pm2\pm2.pid'
if (Test-Path -LiteralPath $pidFile) {
  $registeredId = [int]([IO.File]::ReadAllText($pidFile).Trim())
  $registered = $processes | Where-Object { $_.ProcessId -eq $registeredId }
  if ($registered) {
    if ($registered.Name -ne 'node.exe' -or $registered.CommandLine -notmatch '(?i)pm2.*Daemon\.js') {
      throw 'Registered PM2 PID has been reused.'
    }
    $daemonIds += $registeredId
  }
}
$daemonIds = @($daemonIds | Sort-Object -Unique)
foreach ($daemonId in $daemonIds) {
  $unrelated = @($processes | Where-Object { $_.ParentProcessId -eq $daemonId -and $_.ProcessId -notin $owners })
  if ($unrelated.Count) { throw 'PM2 also owns unclassified children; do not stop this daemon.' }
}
if (@($processes | Where-Object { $_.Name -in @('ffmpeg.exe','WINWORD.EXE','POWERPNT.EXE') }).Count) {
  throw 'Media/document process active; wait or inspect before release.'
}
$players = @($processes | Where-Object {
  ($_.Name -in @('powershell.exe','pwsh.exe') -and $_.CommandLine -match '(?i)[\\/]smart-control[\\/]scripts[\\/](bgm-player|ppt-player)\.ps1') -or
  ($_.Name -in @('chrome.exe','msedge.exe') -and $_.CommandLine -match 'smart-control-player-slot[123]')
})
# Only names/IDs/creation times are recorded, never raw arguments or credentials.
$targets = @($processes | Where-Object { $_.ProcessId -in ($daemonIds + $owners + @($players.ProcessId)) } |
  ForEach-Object { [pscustomobject]@{Pid=$_.ProcessId;Name=$_.Name;Created=$_.CreationDate.ToUniversalTime().ToString('o')} })
$plan = [pscustomobject]@{Version=1;CreatedAt=[DateTime]::UtcNow.ToString('o');
  Tasks=@($tasks | ForEach-Object { @{Name=$_.TaskName;Enabled=[bool]$_.Settings.Enabled} });
  DaemonIds=$daemonIds;ServiceIds=$owners;Targets=$targets}
if (-not $Apply) {
  [pscustomobject]@{Mode='read-only';TaskCount=$tasks.Count;DaemonCount=$daemonIds.Count;
    ServiceCount=$owners.Count;PlayerProcessCount=$players.Count} | ConvertTo-Json -Compress
  return
}
$hold = Join-Path $root 'RELEASE_HOLD'
if (Test-Path -LiteralPath $hold) { throw 'Existing release hold must be reconciled, not overwritten.' }
$snapshot = Join-Path $root ('logs\release-pause-' + [Guid]::NewGuid().ToString('N') + '.json')
# CreateNew prevents a second release from taking over the hold.
$lock = New-Object IO.FileStream($hold, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
try {
  [IO.File]::WriteAllText($snapshot, ($plan | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
  foreach ($name in $taskNames) {
    Disable-ScheduledTask -TaskName $name | Out-Null
    Stop-ScheduledTask -TaskName $name
  }
  # Stop the verified daemons before children, preventing automatic respawn.
  $ordered = @($targets | Where-Object { $_.Pid -in $daemonIds }) + @($targets | Where-Object { $_.Pid -notin $daemonIds })
  foreach ($target in $ordered) {
    $current = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $target.Pid)
    if (-not $current) { continue }
    if ($current.Name -ne $target.Name -or $current.CreationDate.ToUniversalTime().ToString('o') -ne $target.Created) {
      throw 'Process identity changed; do not act on a reused PID.'
    }
    Stop-Process -Id $target.Pid -Force -ErrorAction Stop
  }
  Start-Sleep -Seconds 2
  & (Join-Path $PSScriptRoot 'assert-gk9000-writers-stopped.ps1') -ProjectRoot $root | Out-Null
  if (-not $?) { throw 'Writers did not stop; keep the release hold.' }
  Write-Output ('Release paused. Preserve task snapshot: ' + $snapshot)
} catch {
  throw ('Release pause incomplete; retain RELEASE_HOLD and task snapshot: ' + $snapshot)
} finally { $lock.Dispose() }
