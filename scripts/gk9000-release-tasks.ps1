# Shared production task inventory. Dot-source this file; it produces no output.
$script:Gk9000RequiredReleaseTasks = @(
  'SmartControl-AutoUpdate',
  'SmartControl-DailyBackup',
  'SmartControl-PlayerWatchdog',
  'SmartControlBackend'
)
$script:Gk9000OptionalReleaseTasks = @('SmartControlFrontend')

function Get-Gk9000ReleaseTasks {
  $tasks = @()
  foreach ($name in $script:Gk9000RequiredReleaseTasks) {
    $tasks += Get-ScheduledTask -TaskName $name -ErrorAction Stop
  }
  foreach ($name in $script:Gk9000OptionalReleaseTasks) {
    $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($task) { $tasks += $task }
  }
  return @($tasks)
}

function Assert-Gk9000TaskSnapshot($Snapshot) {
  $entries = @($Snapshot.Tasks)
  $allowed = @($script:Gk9000RequiredReleaseTasks + $script:Gk9000OptionalReleaseTasks)
  foreach ($name in $script:Gk9000RequiredReleaseTasks) {
    if (@($entries | Where-Object { $_.Name -eq $name }).Count -ne 1) {
      throw "Required task is missing from snapshot: $name"
    }
  }
  foreach ($entry in $entries) {
    if ($entry.Name -notin $allowed -or $entry.Enabled -isnot [bool] -or
        @($entries | Where-Object { $_.Name -eq $entry.Name }).Count -ne 1) {
      throw 'Invalid task restoration snapshot.'
    }
  }
}
