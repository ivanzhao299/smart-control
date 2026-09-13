# iOS Face ID retirement and LED display matching

## Follow-up: live HDMI 2.0 cutover, native timing and LAN SSH restored (2026-09-10)

This section supersedes the initial access limitation below. The existing fusioner
tunnel identified an already-authorized jump-host route to GK9000; that route was
successfully reused. GK9000 only trusted the older MacBook key and the jump-host
key, not this Mac mini. Added a dedicated Mac-mini public key restricted to source
`192.168.77.0/24`, preserving existing keys and ACLs. Direct
`ssh user@192.168.77.54 hostname` now returns `GK9000`; the alias
`gk9000-smart-control` also works. No SSH service restart or password-auth change.
The original authorized-keys file was backed up on GK9000 before the append.

After the field cable was moved to the V2460 port labelled **HDMI 2.0**, the
following changes were applied and independently read back:

| Stage | Measured result |
| --- | --- |
| GK9000 `DISPLAY1` / V2460 | Monitor name `HDMI2.0`; Windows desktop and active signal both 3612 x 1462; primary display; scaling IDENTITY |
| GK9000 `DISPLAY2` / projector path | Monitor name `LED_PLAYER_ST`; active signal 3840 x 2160; Windows logical bounds 1280 x 720; secondary display |
| Controller 192.168.50.30 | TCP 5200 reachable from GK9000; read-device-ID response payload `1262`; read checksums and response addresses verified |
| Controller current input | HDMI 2.0 source `0x90`, card slot 0, signal flag 1, 3612 x 1462; old HDMI 1.3 source `0x11` has no signal |
| Active layer 1 | Enabled, source `0x90`, card slot 0, X/Y 0/0, width/height 3612 x 1462 |
| LED player window | Slot 1 pinned to X/Y 0/0 at 3612 x 1462; slot 2 remains on the projector display at 3612/0 and 1280 x 720 |
| Physical receiving matrix | 3612 x 1462, confirmed by user; individual receiving-card mappings not read |

The computer's real desktop/active signal was read through QueryDisplayConfig in
interactive console session 1, not inferred from the browser window or WMI's
single-display summary. Temporary read-only scheduled tasks were removed after
the audit. Audit JSON remains on GK9000 at
`C:\ProgramData\Anksen\led-display-audit-13e5e32a881a4d52ad03cd04473aff3a\display.json`.

The controller EDID was changed from 3840 x 2160 to 3612 x 1462 and caused the
expected brief HDMI renegotiation. Both Windows QueryDisplayConfig and the V2460
input query then returned 3612 x 1462. The active V2460 layer and Edge slot-1
window are also 3612 x 1462, so the source-to-layer geometry is now 1:1.

The requested EDID contained 60 Hz, but Windows enumerates only 23/24/25/29/30 Hz
for 3612 x 1462 on this GK9000 HDMI output and selected approximately 29.97 Hz.
That is a confirmed GK9000 output-mode/bandwidth constraint, not a V2460 HDMI 2.0
input limit. Native-pixel clarity is achieved; 60 Hz would require a higher-
bandwidth GPU output path. Final receiving-card/panel proof still requires a
single-pixel grid viewed on the physical wall.

## Scope and release status

Prepared locally on 2026-09-10, following the user's reports of iOS restarts with
Face ID enabled and blurry LED output. The user confirmed the physical LED pixel
matrix is **3612 × 1462**. These software changes have not been installed on the
phone or released to GK9000. The Windows display mode, V2460 EDID/input layer and
live player geometry were changed during the authorized field cutover and verified
as described above.

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
   Live Windows execution now confirms exact 3612 × 1462 slot-1 placement.
2. The park dashboard 3D map rendered at `renderScale: 0.82` before upscaling its
   framebuffer. It now renders at `1`. The existing 8 FPS cap, low-power mode and
   visibility suspension are preserved. Its 1280 × 884 source aerial image remains
   a source-detail limitation; this change does not manufacture missing detail.
3. The LED adapter defaults now match 3612 × 1462 and logical HDMI1/video/welcome
   actions all select the physically confirmed V2460 HDMI 2.0 source `0x90` rather
   than loading the old HDMI 1.3 preset. This persistence patch is still unreleased.
4. The inspected media transcode path uses H.264 CRF 20 / yuv420p but does not force
   every upload to 1080p. This is not evidence that all source media is pixel-perfect.

## Remaining physical acceptance

Use a native 3612 × 1462 single-pixel grid and small text on the physical wall to
confirm receiving-card/panel mapping and that the controller is not applying a
hidden crop or panel-side scale. The source, desktop, active signal, input and
layer dimensions have already been matched without resampling.

After an approved maintenance window, update the software and launch players only
through the existing interactive console/watchdog route. Never run
`start-players.ps1` directly in an SSH session. Check a native-size test image with
single-pixel lines/grid and small text on the physical wall, then verify ordinary
images/video, projector and audio. A screenshot alone cannot prove LED mapping.

Direct LAN SSH to GK9000 and tunneled TCP access to the V2460 now work. The live
input/output dimensions and player placement were verified from both devices;
only the physical single-pixel-panel inspection remains.

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
- Windows interactive-session execution passed: slot 1 was pinned to 3612 × 1462,
  slot 2 to the projector display, and the audio/PPT daemons were relaunched.
- Nova protocol tests: 19 passed; backend production build passed.
