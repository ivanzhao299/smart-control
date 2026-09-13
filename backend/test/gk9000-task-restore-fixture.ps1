param([Parameter(Mandatory=$true)][string]$ResumeSource)
$ErrorActionPreference = 'Stop'
$start = $ResumeSource.LastIndexOf('  foreach ($task in $snapshot.Tasks)')
$end = $ResumeSource.IndexOf("  Write-Output 'Candidate services verified", $start)
if ($start -lt 0 -or $end -le $start) { throw 'Task restoration section changed.' }
$body = [scriptblock]::Create($ResumeSource.Substring($start, $end - $start))
$script:events = New-Object 'Collections.Generic.List[string]'
function Enable-ScheduledTask { param($TaskName) $script:events.Add('enable:' + $TaskName) }
function Disable-ScheduledTask { param($TaskName) $script:events.Add('disable:' + $TaskName) }
function Start-ScheduledTask { param($TaskName) $script:events.Add('start:' + $TaskName) }
$snapshot = @{Tasks=@(@{Name='SmartControlFrontend';Enabled=$false},
  @{Name='SmartControlBackend';Enabled=$true}, @{Name='SmartControl-PlayerWatchdog';Enabled=$true})}
& $body
if (($script:events -join ',') -ne 'disable:SmartControlFrontend,enable:SmartControlBackend,enable:SmartControl-PlayerWatchdog,start:SmartControl-PlayerWatchdog') {
  throw 'Task state or interactive player startup mismatch.'
}
$script:events.Clear()
$snapshot.Tasks[2].Enabled = $false
& $body
if (@($script:events | Where-Object { $_ -like 'start:*' }).Count) { throw 'Disabled watchdog was started.' }
Write-Output 'PASS mocked restoration preserves disabled tasks and starts only an originally enabled Interactive watchdog; no real tasks changed.'
