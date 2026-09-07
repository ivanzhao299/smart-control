# WMI-created daemons may inherit an environment older than provisioning.
# Read only the configured file path, never the credential itself.
$setting = 'SMART_CONTROL_PLAYER_TOKEN_FILE'
$configuredPath = [Environment]::GetEnvironmentVariable($setting, 'Process')
if ([string]::IsNullOrWhiteSpace($configuredPath)) {
  $configuredPath = [Environment]::GetEnvironmentVariable($setting, 'User')
}
if ([string]::IsNullOrWhiteSpace($configuredPath)) {
  $configuredPath = [Environment]::GetEnvironmentVariable($setting, 'Machine')
}
if ([string]::IsNullOrWhiteSpace($configuredPath)) {
  throw 'Player credential file is not configured.'
}
# Require a local drive-qualified path, not relative, drive-relative or UNC.
# Never probe a network share while resolving credential configuration.
if ($configuredPath -notmatch '^[A-Za-z]:[\\/]') {
  throw 'Player credential file must use an absolute local drive path.'
}
return [System.IO.Path]::GetFullPath($configuredPath)
