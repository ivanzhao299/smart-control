# iOS Face ID retirement and LED display matching

## Follow-up: live field audit and LAN SSH restored (2026-09-10 12:33 CST)

This section supersedes the initial access limitation below. The existing fusioner
tunnel identified an already-authorized jump-host route to GK9000; that route was
successfully reused. GK9000 only trusted the older MacBook key and the jump-host
key, not this Mac mini. Added a dedicated Mac-mini public key restricted to source
`192.168.77.0/24`, preserving existing keys and ACLs. Direct
`ssh user@192.168.77.54 hostname` now returns `GK9000`; the alias
`gk9000-smart-control` also works. No SSH service restart or password-auth change.
The original authorized-keys file was backed up on GK9000 before the append.

Fresh read-only observations:

| Stage | Measured result |
| --- | --- |
| GK9000 primary output, DISPLAY1 | Monitor name `HDMI1.3`; desktop and active signal both 1920 x 1080, approximately 59.94 Hz; Windows path scaling IDENTITY |
| GK9000 secondary output, DISPLAY2 | Monitor name `LED_PLAYER_ST`; desktop and active signal 3840 x 2160, approximately 29.97 Hz; not the primary LED output |
| Controller 192.168.50.30 | TCP 5200 reachable from GK9000; read-device-ID response payload `1262`; read checksums and response addresses verified |
| Controller current input | Source 0x11 is the only input with signal flag 1; 1920 x 1080. Other input entries report no signal |
| Active layer 1 | Enabled, source 0x11, card slot 2, X/Y 0/0, width/height 3612/1462 |
| Layers 2-6 | Disabled; layer 2 is configured for source 0x90 at 3612 x 1462 but has no live input |
| Physical receiving matrix | 3612 x 1462, confirmed by user; individual receiving-card mappings not read |

The computer's real desktop/active signal was read through QueryDisplayConfig in
interactive console session 1, not inferred from the browser window or WMI's
single-display summary. Temporary read-only scheduled tasks were removed after
the audit. Audit JSON remains on GK9000 at
`C:\ProgramData\Anksen\led-display-audit-13e5e32a881a4d52ad03cd04473aff3a\display.json`.

The current chain therefore enlarges a 1920 x 1080 input into a 3612 x 1462 layer.
The [manufacturer's V2460 specifications](https://oss.novastar-led.cn/down/datasheet/shipin/V2460%20%E8%A7%86%E9%A2%91%E6%8E%A7%E5%88%B6%E5%99%A8%20%E8%A7%84%E6%A0%BC%E4%B9%A6%20V1.3.0.pdf)
limit its HDMI 1.3 input custom width/height to 2048. HDMI 2.0 or DP 1.2 is needed
for a full-width 3612-pixel input. Do not force an unsupported custom mode on the
currently connected HDMI 1.3 path or switch to a currently signal-less input.

Next required field action: move the video cable feeding the controller from its
HDMI 1.3 input to the port labeled HDMI 2.0 (confirm the actual cable/port in the
field; do not move the projector cable). Then re-read EDID, available modes and
input status before choosing a supported native-size mode or a 1:1 transport
canvas/crop, adjusting layer input and checking a pixel-grid test on the wall.
No resolution, layer, receiver mapping or production software was changed during
this follow-up. The previous software fixes remain local/unreleased.

## Scope and release status

Prepared locally on 2026-09-10, following the user's reports of iOS restarts with
Face ID enabled and blurry LED output. The user confirmed the physical LED pixel
matrix is **3612 × 1462**. These changes have not been installed on the phone or
released to GK9000. No Windows display mode, EDID, LED processor configuration or
live playback was changed during diagnosis.

## iOS

- Removed the native Face ID settings toggle, cold-start/resume app lock and
  biometric authentication implementation, including its usage-description key.
- Clear only the legacy `biometric_lock` preference during app initialization.
  Server settings, ordinary login sessions and account/role authorization remain.
- Keep inert native bridge methods for cached web pages. Do not prompt for
  biometrics or read/write biometric passwords through the bridge.
- Web login suppresses biometric entry points for both the new iOS platform flag
  and the legacy WKWebView bridge. Android biometric behavior remains unchanged.
- Updating the web bundle can hide web login buttons on older installed shells,
  but removing their native app-lock toggle requires installing a new iOS build.

No device crash log was available: this retires the requested feature, not a
claim that the specific OS/process restart cause has been independently proven.

## LED findings and bounded corrections

1. The LED launcher used a fixed 1920 × 1080 rectangle by default, whereas the
   projector already followed actual display bounds. LED startup now follows the
   primary monitor bounds, retains explicit calibration overrides and retains a
   fallback when display enumeration fails. A mismatch with 3612 × 1462 is logged.
   Windows DPI virtualization and the physical active signal still need checking.
2. The park dashboard 3D map rendered at `renderScale: 0.82` before upscaling its
   framebuffer. It now renders at `1`. The existing 8 FPS cap, low-power mode and
   visibility suspension are preserved. Its 1280 × 884 source aerial image remains
   a source-detail limitation; this change does not manufacture missing detail.
3. The LED adapter's unconfigured full-screen layer defaults remain 1920 × 1080
   (`LED_RESOLUTION_WIDTH/HEIGHT`). Current production values could not be read.
   Do not change these blindly: confirm the actual input, layer and screen mapping
   first. Changing a source resolution or layer can blank/crop the physical output.
4. The inspected media transcode path uses H.264 CRF 20 / yuv420p but does not force
   every upload to 1080p. This is not evidence that all source media is pixel-perfect.

## Remaining physical acceptance

Record GK9000 Windows advanced display readings for the LED output: desktop mode,
active signal mode, scaling and refresh rate. Record the processor model, input
signal dimensions, source crop, destination layer rectangle and output mapping.
The content raster must map onto the confirmed 3612 × 1462 receiving pixels
without resampling. A larger transport canvas with a 1:1 crop can also satisfy
that requirement; do not force an unsupported custom HDMI timing.

After an approved maintenance window, update the software and launch players only
through the existing interactive console/watchdog route. Never run
`start-players.ps1` directly in an SSH session. Check a native-size test image with
single-pixel lines/grid and small text on the physical wall, then verify ordinary
images/video, projector and audio. A screenshot alone cannot prove LED mapping.

Access during this investigation: the application HTTP entry was reachable, but
GK9000 SSH authentication was rejected and the recorded LED controller service
could not be reached. Thus no live input/output dimensions or final physical
clarity were verified.

## Validation

- iOS Debug simulator build: passed using Xcode 26.6, unsigned. This is not a
  TestFlight upload or real-phone cold-start/resume acceptance.
- Frontend typecheck and production build: passed.
- Frontend regression tests cover retired iOS bridge calls, legacy shells,
  Android preservation, display-bound selection and full-resolution map rendering.
- Real Chrome, built frontend, disposable MOCK backend: ordinary iOS-style login,
  reload and authorized control passed, with no biometric bridge calls.
- The previous device-realtime fix also passed in that run: replacement rendered
  8–13 ms after API success; independent slots 2/3 rendered in 26 ms. These are
  local browser results, not physical LED response measurements.
- No PowerShell runtime was available here; the launcher has structural regression
  coverage only. Windows execution and physical display acceptance remain pending.
