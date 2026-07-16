# ==============================================================
# Edge policy for the kiosk players.
#
# Why (2026-07-16):
#   PlayerPage uses setSinkId() to push slot1/2 audio out the HDMI endpoint
#   (-> splitter -> matrix IN4 -> OUT5 -> LED amp) instead of the Windows default
#   device (USB sound card -> IN1, which OUT5 does not listen to).
#   To pick the HDMI endpoint the page must read device LABELS, and Chromium only
#   exposes labels once the origin has microphone permission.
#
#   The first attempt used --use-fake-ui-for-media-stream to auto-accept the
#   prompt. It worked, but Edge then paints a yellow "you are using an
#   unsupported command-line flag" infobar across the top of the LED wall.
#   AudioCaptureAllowedUrls grants the same permission as a proper policy:
#   no prompt, no flag, no warning bar.
#
# Run ON GK9000 elevated (HKLM write):
#   powershell -ExecutionPolicy Bypass -File scripts\setup-edge-policy.ps1
# Players must be restarted afterwards to pick the policy up.
#
# NOTE: ASCII-only (PowerShell 5.1 on Chinese Windows reads .ps1 as GBK; a
# non-ASCII comment eats the next newline and silently comments out real code).
# ==============================================================
$ErrorActionPreference = 'Stop'

$origins = @('http://localhost:5173')

foreach ($policy in @('AudioCaptureAllowedUrls', 'VideoCaptureAllowedUrls')) {
  $key = "HKLM:\SOFTWARE\Policies\Microsoft\Edge\$policy"
  if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
  # policy lists are numbered string values starting at 1
  $i = 1
  foreach ($o in $origins) {
    New-ItemProperty -Path $key -Name "$i" -Value $o -PropertyType String -Force | Out-Null
    $i++
  }
  Write-Output ("set $policy = " + ($origins -join ', '))
}

Write-Output ''
Write-Output 'Verify:'
foreach ($policy in @('AudioCaptureAllowedUrls', 'VideoCaptureAllowedUrls')) {
  $key = "HKLM:\SOFTWARE\Policies\Microsoft\Edge\$policy"
  Get-Item $key | Select-Object -ExpandProperty Property | ForEach-Object {
    Write-Output ("  $policy[$_] = " + (Get-ItemProperty -Path $key -Name $_).$_)
  }
}
Write-Output ''
Write-Output 'Restart the players for this to take effect.'
