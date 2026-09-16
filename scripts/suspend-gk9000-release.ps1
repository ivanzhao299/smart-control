# One-host release pause. Default is read-only; -Apply retains a hold on failure.
# Does not migrate, provision credentials, update code, or restart anything.
[CmdletBinding()]
param(
  [switch]$Apply,
  [string]$SnapshotPath,
  [ValidatePattern('^[a-f0-9]{40}$')][string]$PreReleaseRevision
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = 'D:\smart-control'
if ($env:COMPUTERNAME -ne 'GK9000') { throw 'GK9000 only.' }
. (Join-Path $PSScriptRoot 'gk9000-release-tasks.ps1')
$tasks = @(Get-Gk9000ReleaseTasks)
$taskNames = @($tasks | ForEach-Object { $_.TaskName })
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
  $unrelated = @()
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    $processes = @(Get-CimInstance Win32_Process)
    $unrelated = @($processes | Where-Object { $_.ParentProcessId -eq $daemonId -and $_.ProcessId -notin $owners })
    if (-not $unrelated.Count) { break }
    if ($attempt -lt 3) { Start-Sleep -Seconds 1 }
  }
  if ($unrelated.Count) { throw 'PM2 also owns persistent unclassified children; do not stop this daemon.' }
}
$players = @($processes | Where-Object {
  ($_.Name -in @('powershell.exe','pwsh.exe') -and $_.CommandLine -match '(?i)[\\/]smart-control[\\/]scripts[\\/](bgm-player|ppt-player)\.ps1') -or
  ($_.Name -in @('chrome.exe','msedge.exe') -and $_.CommandLine -match 'smart-control-player-slot[123]')
})
$managedExternal = @()
foreach ($process in @($processes | Where-Object { $_.Name -in @('ffmpeg.exe','WINWORD.EXE','POWERPNT.EXE') })) {
  $managed = ($process.Name -eq 'ffmpeg.exe' -and $process.ParentProcessId -in $owners -and
      [string]$process.CommandLine -match '(?i)D:[\\/]smart-control-tools[\\/]ffmpeg') -or
    ($process.Name -in @('WINWORD.EXE','POWERPNT.EXE') -and $process.ParentProcessId -in @($players.ProcessId))
  if (-not $managed) { throw 'Unclassified media/document process active; wait or inspect before release.' }
  $managedExternal += $process
}
# Only names/IDs/creation times are recorded, never raw arguments or credentials.
$targets = @($processes | Where-Object { $_.ProcessId -in ($daemonIds + $owners + @($players.ProcessId) + @($managedExternal.ProcessId)) } |
  ForEach-Object { [pscustomobject]@{Pid=$_.ProcessId;Name=$_.Name;Created=$_.CreationDate.ToUniversalTime().ToString('o')} })
if ($PreReleaseRevision) {
  $sourceRevision = $PreReleaseRevision
} else {
  $sourceRevision = (& git -C $root rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Unable to read source revision.' }
}
if ($sourceRevision -notmatch '^[a-f0-9]{40}$') { throw 'Unable to record source revision.' }
$plan = [pscustomobject]@{Version=1;CreatedAt=[DateTime]::UtcNow.ToString('o');SourceRevision=$sourceRevision;
  Tasks=@($tasks | ForEach-Object { @{Name=$_.TaskName;Enabled=[bool]$_.Settings.Enabled} });
  DaemonIds=$daemonIds;ServiceIds=$owners;Targets=$targets}
if (-not $Apply) {
  [pscustomobject]@{Mode='read-only';TaskCount=$tasks.Count;DaemonCount=$daemonIds.Count;
    ServiceCount=$owners.Count;PlayerProcessCount=$players.Count;ManagedExternalCount=$managedExternal.Count} | ConvertTo-Json -Compress
  return
}
$hold = Join-Path $root 'RELEASE_HOLD'
if (Test-Path -LiteralPath $hold) { throw 'Existing release hold must be reconciled, not overwritten.' }
$logs = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$snapshot = if ($SnapshotPath) { [IO.Path]::GetFullPath($SnapshotPath) } else {
  Join-Path $logs ('release-pause-' + [Guid]::NewGuid().ToString('N') + '.json')
}
if ((Split-Path -Parent $snapshot).TrimEnd('\') -ne $logs.TrimEnd('\') -or (Test-Path -LiteralPath $snapshot)) {
  throw 'Task snapshot must be a new file in the production logs directory.'
}
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
    # A verified child can exit between the identity check and Stop-Process.
    # Treat that as already stopped; the final fence is the authoritative test.
    Stop-Process -Id $target.Pid -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 2
  & (Join-Path $PSScriptRoot 'assert-gk9000-writers-stopped.ps1') -ProjectRoot $root | Out-Null
  if (-not $?) { throw 'Writers did not stop; keep the release hold.' }
  Write-Output ('Release paused. Preserve task snapshot: ' + $snapshot)
} catch {
  $reason = $_.Exception.Message
  foreach ($name in $taskNames) {
    Disable-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue | Out-Null
    Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  }
  foreach ($target in $targets) {
    $current = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $target.Pid) -ErrorAction SilentlyContinue
    if ($current -and $current.Name -eq $target.Name -and
        $current.CreationDate.ToUniversalTime().ToString('o') -eq $target.Created) {
      Stop-Process -Id $target.Pid -Force -ErrorAction SilentlyContinue
    }
  }
  throw ('Release pause incomplete; retain RELEASE_HOLD and task snapshot: ' + $snapshot + '. Cause: ' + $reason)
} finally { $lock.Dispose() }
