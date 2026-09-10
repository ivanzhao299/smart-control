# iOS Face ID retirement and LED display matching

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
