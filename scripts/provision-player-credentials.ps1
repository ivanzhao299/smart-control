# Initial provisioning only. No rotation, service restart or kiosk launch.
[CmdletBinding()]
param(
  [string]$ProjectRoot = 'D:\smart-control',
  [string]$CredentialDirectory = 'C:\ProgramData\Anksen\smart-control-player-credentials',
  [string]$PlayerAccount = 'user',
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$envPath = Join-Path $ProjectRoot 'backend\.env'
if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) { throw 'Existing backend environment file required.' }
if (Test-Path -LiteralPath $CredentialDirectory) { throw 'Credential directory already exists; initial provisioning refuses overwrite.' }
if ($CredentialDirectory -notmatch '^[A-Za-z]:[\\/]' -or $CredentialDirectory.Contains('..')) {
  throw 'Use an absolute local credential directory without parent traversal.'
}
# Reject links along both destination and environment paths before reading/writing.
foreach ($target in @($CredentialDirectory, $envPath)) {
  $cursor = $target
  while ($cursor) {
    if (Test-Path -LiteralPath $cursor) {
      if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'Provisioning paths must not contain reparse points.'
      }
    }
    $parent = Split-Path -Parent $cursor
    if ($parent -eq $cursor) { break }
    $cursor = $parent
  }
}
$bytes = [IO.File]::ReadAllBytes($envPath)
$encoding = New-Object Text.UTF8Encoding($false, $true)
$offset = 0
if ($bytes.Length -ge 2 -and $bytes[0] -eq 255 -and $bytes[1] -eq 254) { $encoding = [Text.Encoding]::Unicode; $offset = 2 }
elseif ($bytes.Length -ge 2 -and $bytes[0] -eq 254 -and $bytes[1] -eq 255) { $encoding = [Text.Encoding]::BigEndianUnicode; $offset = 2 }
elseif ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) { $offset = 3 }
$existing = $encoding.GetString($bytes, $offset, $bytes.Length - $offset)
if ($existing -match '(?m)^\s*PLAYER_DEVICE_CREDENTIALS\s*=') { throw 'Existing device configuration requires a separate reviewed rotation.' }
$account = New-Object Security.Principal.NTAccount($PlayerAccount)
$playerSid = $account.Translate([Security.Principal.SecurityIdentifier])
if (-not $Apply) {
  Write-Output 'Preflight passed. Apply will create protected device files, back up the environment file, append hashes, and configure the machine token-file path. No service will restart.'
  return
}
if ($env:COMPUTERNAME -ne 'GK9000') { throw 'Production provisioning is restricted to GK9000.' }
if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'RELEASE_HOLD') -PathType Leaf)) {
  throw 'Provision credentials only during a controlled release hold.'
}
foreach ($scope in @('Process', 'User', 'Machine')) {
  if ([Environment]::GetEnvironmentVariable('SMART_CONTROL_PLAYER_TOKEN_FILE', $scope)) {
    throw 'Existing credential path must not be overwritten or shadow the new setting.'
  }
}
& (Join-Path $PSScriptRoot 'assert-gk9000-writers-stopped.ps1') -ProjectRoot $ProjectRoot | Out-Null
if (-not $?) { throw 'Production writers must be stopped before provisioning.' }
# Install the directory ACL BEFORE creating any credentials or environment backup.
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
foreach ($sid in @($playerSid, (New-Object Security.Principal.SecurityIdentifier('S-1-5-18')),
    (New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))) {
  $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  $acl.AddAccessRule($rule)
}
[IO.Directory]::CreateDirectory($CredentialDirectory, $acl) | Out-Null
$actualAcl = Get-Acl -LiteralPath $CredentialDirectory
if (-not $actualAcl.AreAccessRulesProtected) { throw 'Credential directory ACL is not protected.' }
$allowedSids = @($playerSid.Value, 'S-1-5-18', 'S-1-5-32-544')
foreach ($entry in $actualAcl.Access) {
  $sid = $entry.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
  if ($entry.AccessControlType -eq 'Allow' -and $sid -notin $allowedSids) {
    throw 'Credential directory grants unexpected access.'
  }
}
$utf8 = New-Object Text.UTF8Encoding($false)
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$sha = [Security.Cryptography.SHA256]::Create()
$entries = @()
try {
  foreach ($device in @(@{id='gk9000-led';slots=@(1);file='led.token'},
      @{id='gk9000-projector';slots=@(2);file='projector.token'},
      @{id='gk9000-native';slots=@(1,2,3);file='native.token'})) {
    $random = New-Object byte[] 32
    $rng.GetBytes($random)
    $token = [BitConverter]::ToString($random).Replace('-', '').ToLowerInvariant()
    $digest = [BitConverter]::ToString($sha.ComputeHash($utf8.GetBytes($token))).Replace('-', '').ToLowerInvariant()
    [IO.File]::WriteAllText((Join-Path $CredentialDirectory $device.file), $token, $utf8)
    $entries += @{id=$device.id;sha256=$digest;slots=$device.slots;enabled=$true}
  }
  # Retain the exact original bytes in the already protected directory.
  [IO.File]::WriteAllBytes((Join-Path $CredentialDirectory 'backend.env.before'), $bytes)
  $line = 'PLAYER_DEVICE_CREDENTIALS=' + (ConvertTo-Json -InputObject $entries -Compress -Depth 4)
  # Stage beside the destination with its existing ACL, then replace atomically.
  # A failed write must not truncate the application's environment file.
  $stagedEnv = $envPath + '.provision-' + [Guid]::NewGuid().ToString('N')
  $stream = New-Object IO.FileStream($stagedEnv, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $stream.SetAccessControl((Get-Acl -LiteralPath $envPath))
    $updatedBytes = $utf8.GetBytes($existing + "`r`n" + $line + "`r`n")
    $stream.Write($updatedBytes, 0, $updatedBytes.Length)
    $stream.Flush($true)
  } finally { $stream.Dispose() }
  if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($envPath)) -ne [Convert]::ToBase64String($bytes)) {
    throw 'Environment changed during provisioning; preserve staged file for reconciliation.'
  }
  [IO.File]::Replace($stagedEnv, $envPath, [NullString]::Value)
  [Environment]::SetEnvironmentVariable('SMART_CONTROL_PLAYER_TOKEN_FILE',
    (Join-Path $CredentialDirectory 'native.token'), 'Machine')
  Write-Output 'Provisioned three device identities. No tokens printed. Services and kiosks were not restarted.'
} catch {
  # Do not destroy potentially installed credentials or restore config blindly.
  throw 'Provisioning incomplete. Preserve the protected directory and environment backup; do not deploy until reconciled.'
} finally { $rng.Dispose(); $sha.Dispose(); $token = $null }
