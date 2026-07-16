# GK9000 WireGuard CI Deployment

Pushes to `main` are validated by GitHub Actions and deployed to the exhibition controller through the Aliyun WireGuard gateway.

## Network Route

`GitHub Actions -> 123.57.220.65 -> WireGuard 10.66.66.1 -> GK9000 10.66.66.3`

- Existing office Ubuntu peer: `10.66.66.2`, unchanged.
- GK9000 peer: `10.66.66.3/32`.
- The GK9000 tunnel service is `WireGuardTunnel$gk9000` and starts automatically.
- Only the tunnel address is routed; the `192.168.77.0/24` LAN is not exposed through this peer.

## Repository Secrets

- `GK9000_DEPLOY_JUMP_SSH_KEY`: dedicated restricted key for the Aliyun jump host.
- `GK9000_DEPLOY_JUMP_KNOWN_HOSTS`: pinned Aliyun SSH host keys.

The GitHub key can only request `gk9000-deploy <SHA>` or `gk9000-verify <SHA>`. The GK9000 SSH private key stays on the Aliyun gateway.

## Deployment Contract

The deployment script:

1. locks deployment to one process;
2. rejects tracked changes on GK9000;
3. accepts only commits reachable from `origin/main`;
4. fast-forwards the checked-out repository;
5. invokes the existing production backup;
6. installs locked dependencies and builds backend/frontend;
7. restarts both services **through pm2** (`pm2 restart smart-control-backend smart-control-frontend`), the single process owner as of 2026-07-16 — the old scheduled-task restart was removed because `SmartControlBackend` now only boot-resurrects pm2 and `SmartControlFrontend` is disabled (see `scripts/boot-pm2.ps1`);
8. verifies ports `3200` and `5173`;
9. restores the previous commit and build artifacts if deployment fails;
10. writes deployment logs and JSON audit records under `D:\smart-control\logs`.

The workflow does not print or export `.env`, database content, or hardware credentials. It invokes the existing local backup script before replacement, so the protected production backup remains on GK9000. It does not expose the Windows LAN through WireGuard.

## Troubleshooting

- **`Test-Path: parameter 'Path' is null` during restart** — the double-hop non-interactive SSH session (GitHub → Aliyun → WireGuard → GK9000) does **not** populate `$env:APPDATA`. Never build the pm2 path from it. `Restart-Services` in `scripts/deploy-from-ci.ps1` resolves pm2 from a fixed known location and sets `PM2_HOME` explicitly; do the same in any new script that shells out to pm2 from the CI path.
- **`ERR_PNPM_OUTDATED_LOCKFILE`** — a dependency was added to `package.json` without committing the regenerated `pnpm-lock.yaml`. CI uses `--frozen-lockfile`; regenerate with the pinned pnpm version and commit the lockfile in the same change.
