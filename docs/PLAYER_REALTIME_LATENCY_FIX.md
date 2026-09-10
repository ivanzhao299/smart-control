# Player realtime authentication regression — 2026-09-10

## Finding

The dedicated PlayerPage reads its state with `X-Player-Token`, but used the
shared personal-account WebSocket client. That client closes immediately when
neither a user nor administrator token exists. The status gateway also had no
device-authentication handler. Consequently the device-only kiosk could read
state but could not receive `playback_channel_changed`; its unchanged 30-second
fallback became the only update path. A successful publish response means the
backend accepted the state change, not that the physical screen displayed it.

Read-only inspection of the live frontend verified both the account-only socket
and 30-second fallback in the served bundles. Its deployment-version metadata
reported clean revision `785f26f2071151fe215eb4acfb21ab61381b28dd`, matching the
remote main used for this isolated candidate. Backend health returned in about
9ms in one LAN probe. Backend `/system/info` did not expose a commit, so backend
runtime SHA and actual kiosk socket logs remain unverified. Direct SSH was denied;
no credentials, services, playback state, or production configuration were changed.

## Repair

- Dedicated per-player WebSocket instance uses `authenticate_player` with the
  existing scoped device credential, never a user/admin credential fallback.
- Server verifies the device and requested slot before hello; devices get no
  global snapshot and only content-free invalidations for their subscribed slot.
- Every event/heartbeat revalidates device revocation, rotation, and slot scope.
  Media permissions remain checked independently by existing REST/stream paths.
- Each authenticated hello immediately reconciles REST state, including changes
  missed during startup/disconnection. Page disposal closes its own connection.
- The 30-second polling fallback is unchanged. This is not a polling-frequency
  workaround and does not disable authentication.

## Validation (isolated Mock environment)

- Node 20 backend build and frontend typecheck/production build: passed.
- Backend Jest: 51 suites / 605 tests passed.
- Frontend Node tests: 46 passed, including six realtime regressions.
- Fresh migrated disposable SQLite/media tree + actual Chrome + built frontend
  + real backend HTTP/WebSocket: passed, without personal credentials on players.
- Final run: slot 1 initial image rendered in 18ms; three successive replacements
  took 10/15/16ms total, or 8/12/13ms after the publish API returned success.
- Artificial disconnect + missed stop reconciled after reconnect in 1290ms.
- Browser slots 2 and 3 rendered test images in 21ms and 30ms, respectively, with
  independent synthetic credentials. These are browser-path tests, not Windows
  native MCI audio or Office COM playback acceptance.
- Existing real-browser private upload, role isolation, Range/416, revocation,
  dedicated-profile persistence, and 390px account workflows passed.

Run with:

```sh
cd backend
pnpm test --runInBand
pnpm build
cd ../frontend
node --test tests/*.test.cjs
pnpm build
cd ../backend
PLAYWRIGHT_MODULE_PATH=/path/to/playwright node test/run-disposable-browser.cjs
```

## Release gate / remaining acceptance

This candidate is not deployed. Obtain a playback interruption window before
restarting backend or refreshing kiosks. Re-fetch, revalidate the candidate if
main moved, and prove candidate/merged/runtime revisions before acceptance.
The backend must support device authentication before loading the new player
bundle; an existing kiosk must be refreshed to receive new JS. Do not put an
administrator token in a kiosk or restore anonymous WebSocket access.

After release, verify both physical displays switching existing content under
normal load and record publish-to-display timings. Native background music
currently has a 3s loop, and the Office daemon has a 1200ms loop plus COM work;
this patch does not claim to optimize or validate those independent paths.
