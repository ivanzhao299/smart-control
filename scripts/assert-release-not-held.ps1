param([Parameter(Mandatory = $true)][string]$ReleaseProjectRoot)
# No age/PID-based expiry. The release controller owns removal after activation/recovery.
# This blocks new entry points; it does not terminate already-running writers.
$releaseHoldPath = Join-Path $ReleaseProjectRoot 'RELEASE_HOLD'
if (Test-Path -LiteralPath $releaseHoldPath -ErrorAction Stop) {
  throw 'RELEASE_HOLD is present. Keep services stopped until controlled activation or recovery.'
}
