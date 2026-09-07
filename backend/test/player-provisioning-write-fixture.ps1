# Runs only the provisioning write section against synthetic files in a new temp
# directory. The machine-environment setter is replaced with a test sink.
param([Parameter(Mandatory = $true)][string]$ProvisionSource, [switch]$FailBeforeReplace)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$start = $ProvisionSource.IndexOf('# Install the directory ACL BEFORE')
if ($start -lt 0) { throw 'Provisioning write section not found.' }
$body = $ProvisionSource.Substring($start)
$setter = "[Environment]::SetEnvironmentVariable('SMART_CONTROL_PLAYER_TOKEN_FILE',`n    (Join-Path `$CredentialDirectory 'native.token'), 'Machine')"
if (-not $body.Contains($setter)) { throw 'Machine setter changed; review fixture before execution.' }
$body = $body.Replace($setter, "Set-TestCredentialPath (Join-Path `$CredentialDirectory 'native.token')")
# Preserve the original exception for diagnostics on synthetic files only.
$body = $body.Replace("throw 'Provisioning incomplete. Preserve the protected directory and environment backup; do not deploy until reconciled.'", 'throw')
if ($body.Contains('SetEnvironmentVariable')) { throw 'Unexpected environment mutation in fixture.' }
$replace = '[IO.File]::Replace($stagedEnv, $envPath, [NullString]::Value)'
if ($FailBeforeReplace) {
  if (-not $body.Contains($replace)) { throw 'Atomic replacement changed; review fixture.' }
  $body = $body.Replace($replace, "throw 'Synthetic replacement failure'")
}
$script:configuredPath = $null
function Set-TestCredentialPath([string]$value) { $script:configuredPath = $value }
$root = Join-Path ([IO.Path]::GetTempPath()) ('sc-player-provision-test-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($root) | Out-Null
try {
  $CredentialDirectory = Join-Path $root 'protected'
  $envPath = Join-Path $root 'synthetic.env'
  $playerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $existing = "MOCK_MODE=true`r`nTEST_ONLY=synthetic`r`n"
  $bytes = [Text.Encoding]::UTF8.GetBytes($existing)
  [IO.File]::WriteAllBytes($envPath, $bytes)
  if ($FailBeforeReplace) {
    $failed = $false
    try { & ([scriptblock]::Create($body)) | Out-Null } catch { $failed = $true }
    if (-not $failed -or $script:configuredPath) { throw 'Failure did not stop configuration.' }
    if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($envPath)) -ne [Convert]::ToBase64String($bytes)) {
      throw 'Failed replacement changed original environment.'
    }
    $staged = @(Get-ChildItem -LiteralPath $root -Filter 'synthetic.env.provision-*')
    if ($staged.Count -ne 1 -or $staged[0].Length -le $bytes.Length) { throw 'Expected staged evidence missing.' }
    Write-Output 'PASS injected replacement failure preserves original environment and staged evidence; machine setter not called.'
    return
  }
  & ([scriptblock]::Create($body)) | Out-Null
  if ($script:configuredPath -ne (Join-Path $CredentialDirectory 'native.token')) { throw 'Wrong configured path.' }
  $backup = [IO.File]::ReadAllBytes((Join-Path $CredentialDirectory 'backend.env.before'))
  if ([Convert]::ToBase64String($backup) -ne [Convert]::ToBase64String($bytes)) { throw 'Backup bytes changed.' }
  $updated = [IO.File]::ReadAllText($envPath)
  if (-not $updated.StartsWith($existing)) { throw 'Existing environment lost.' }
  $line = @($updated -split "`r?`n" | Where-Object { $_.StartsWith('PLAYER_DEVICE_CREDENTIALS=') })
  if ($line.Count -ne 1) { throw 'Wrong environment entry count.' }
  $config = $line[0].Substring('PLAYER_DEVICE_CREDENTIALS='.Length) | ConvertFrom-Json
  if ($config.Count -ne 3) { throw 'Wrong identity count.' }
  $names = @{'gk9000-led'='led.token';'gk9000-projector'='projector.token';'gk9000-native'='native.token'}
  $hash = [Security.Cryptography.SHA256]::Create()
  try {
    $seen = @{}
    foreach ($entry in $config) {
      $value = [IO.File]::ReadAllText((Join-Path $CredentialDirectory $names[$entry.id]))
      if ($value -notmatch '^[a-f0-9]{64}$' -or $seen.ContainsKey($value)) { throw 'Invalid or duplicate token.' }
      $seen[$value] = $true
      $digest = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($value))).Replace('-', '').ToLowerInvariant()
      if ($entry.sha256 -ne $digest -or $updated.Contains($value)) { throw 'Digest mismatch or plaintext in server config.' }
      if ($entry.id -eq 'gk9000-native') { $expected = '1,2,3' }
      elseif ($entry.id -eq 'gk9000-led') { $expected = '1' } else { $expected = '2' }
      if (($entry.slots -join ',') -ne $expected -or -not $entry.enabled) { throw 'Invalid slot binding.' }
    }
  } finally { $hash.Dispose() }
  $acl = Get-Acl -LiteralPath $CredentialDirectory
  if (-not $acl.AreAccessRulesProtected) { throw 'Directory ACL not protected.' }
  Write-Output 'PASS isolated Windows write fixture: ACL, unique tokens, digest/slot bindings, exact backup, preserved environment; machine setter mocked.'
} finally {
  # Only this newly created GUID test directory; never a production path.
  if ($root -and (Split-Path -Leaf $root) -match '^sc-player-provision-test-[a-f0-9]{32}$') {
    [IO.Directory]::Delete($root, $true)
  }
}
