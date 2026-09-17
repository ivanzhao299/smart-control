# iPhone PWA media list Network Error — 2026-09-17

## Scope and evidence

The user reports that an administrator opening the media library in an iPhone
home-screen PWA immediately receives `加载失败: Network Error`.

- Production GK9000 and origin/main were both
  `d4c29e28b7e105d0787452b00cd9e254b0bca234` before this change.
- The documented production PWA is `https://erp.cnjinhu.top/control/`.
  The phone's saved origin/API override has not been directly observed.
- The public API responds with the expected 401 to anonymous media reads; no
  media server exception corresponding to the reported failure was found.
- Media requests use Axios 1.20's fetch adapter; other pages use native fetch.
  The adapter inserts `User-Agent: axios/1.20.0` unless the header is disabled.
- Chromium drops that override. Safari 26.2 preserves it. In a cross-origin
  request Safari includes `user-agent` in Access-Control-Request-Headers.
  The production CORS policy does not allow that header.

## Browser reproduction

A loopback-only fixture reproduced the production CORS header allowlist with a
separate API origin, synthetic credentials, and a Service Worker forwarding
network-only requests. No production records, credentials, or playback changed.

Safari 26.2, with `PWA controlled: true`:

| Request | Result |
| --- | --- |
| Native fetch | PASS |
| Existing Axios fetch options | `Network Error` / `TypeError: Load failed` |
| Axios with `User-Agent: false` | PASS |
| Actual fixed media.service.ts bundled from this checkout | PASS |

The fixture recorded preflight headers `authorization` for native fetch and
`authorization,user-agent` for the failing Axios request. Same-origin requests
passed even before the fix. Thus this is a proven Safari cross-origin defect,
not proof of the exact unobserved phone route; phone acceptance remains required.

## Fix and security boundaries

1. Disable Axios's User-Agent override on every media request. This preserves the
   browser's own header and avoids adding a browser-identity header to CORS policy.
2. Add the existing upload quota hint `X-Upload-Size` to allowed request headers.
   Without it, cross-origin uploads fail preflight even after list reads work.
3. Extract the unchanged CORS configuration into `createCorsOptions` so a real
   Nest HTTP fixture can test the application's actual policy.

No origin wildcard, credential-cookie permission, auth bypass, or redirect
relaxation was added. User/admin tokens, identity-switch cancellation and
no-store behavior remain intact. A test using the real Axios adapter failed with
Network Error before the fix and passed afterward.

## Validation and release boundary

- Frontend: 92/92 tests; typecheck and production build.
- Backend: 739/739 tests in 88 suites; production build.
- Operations: 67 passed, 3 environment-dependent skips.
- Actual fixed media module passed in Safari's controlled Service Worker fixture.

The user explicitly approved deployment using the previous local-validation
fallback and a brief GK9000 backend restart on 2026-09-17. GitHub-hosted CI could
not start due to the existing account/budget restriction; it is not reported as
passing. The combined frontend/backend fix requires restarting the backend,
which resets current playback to idle under the existing production policy.
Recheck GitHub CI availability/budget, merged SHA, runtime SHA,
allowed upload preflight, health, and an actual iPhone media-list operation.
Do not treat the isolated Safari fixture as physical-phone acceptance.
