# Execute the real stop-order section with mocked Windows mutation commands.
param([Parameter(Mandatory = $true)][string]$SuspendSource)
$ErrorActionPreference = 'Stop'
$start = $SuspendSource.IndexOf('  foreach ($name in $taskNames)')
$end = $SuspendSource.IndexOf('  Start-Sleep', $start)
if ($start -lt 0 -or $end -lt $start) { throw 'Pause section changed; review fixture.' }
$body = [scriptblock]::Create($SuspendSource.Substring($start, $end - $start))
$script:events = New-Object 'Collections.Generic.List[string]'
function Disable-ScheduledTask { param($TaskName) $script:events.Add('disable:' + $TaskName) }
function Stop-ScheduledTask { param($TaskName) $script:events.Add('task-stop:' + $TaskName) }
function Stop-Process { param($Id, [switch]$Force, $ErrorAction) $script:events.Add('process-stop:' + $Id) }
function Get-CimInstance {
  param($ClassName, $Filter)
  $id = [int]($Filter -replace 'ProcessId=', '')
  return @{Name='node.exe';ProcessId=$id;CreationDate=$script:currentCreation}
}
$script:currentCreation = [DateTime]::Parse('2026-09-01T00:00:00Z').ToUniversalTime()
$created = $script:currentCreation.ToString('o')
$taskNames = @('fixture-task')
$daemonIds = @(100)
$targets = @(@{Pid=101;Name='node.exe';Created=$created}, @{Pid=100;Name='node.exe';Created=$created})
& $body
if (($script:events -join ',') -ne 'disable:fixture-task,task-stop:fixture-task,process-stop:100,process-stop:101') {
  throw 'Unexpected task/daemon/child stop order.'
}
Write-Output 'PASS mocked stop order: tasks first, daemon before service child.'
$script:events.Clear()
$script:currentCreation = $script:currentCreation.AddSeconds(1)
$rejected = $false
try { & $body } catch { $rejected = $_.Exception.Message -match 'identity changed' }
if (-not $rejected -or @($script:events | Where-Object { $_ -like 'process-stop:*' }).Count) {
  throw 'Reused PID was not rejected before process mutation.'
}
Write-Output 'PASS mocked PID reuse rejects process termination; no actual Windows tasks or processes changed.'
