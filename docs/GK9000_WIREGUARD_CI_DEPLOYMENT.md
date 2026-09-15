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

The deployment script (`scripts/deploy-from-ci.ps1`) auto-detects the change scope via `git diff --name-only` and chooses the minimal deployment path (since 2026-09-14, see `docs/MINIMAL_DEPLOYMENT_RULES.md`):

1. locks deployment to one process;
2. rejects tracked changes on GK9000;
3. accepts only commits reachable from `origin/main`;
4. leaves unrelated untracked files untouched; if an untracked path truly conflicts with the target commit, moves it into the rollback snapshot instead of deleting it; protected data/database/log paths fail the deployment closed;
5. fast-forwards the checked-out repository;
6. invokes the existing production backup;
7. **scope-aware build** — static assets (`frontend/public/**`) are copied directly to `dist/` with no build or restart; frontend code (`frontend/src/**`) is side-built and swapped into `dist/` with no restart (vite preview reads from disk); backend code (`backend/src/**`) is built and only the backend is restarted; high-risk changes (deps, config, migrations, deploy scripts, or mixed tiers) trigger the full build+migrate+restart path;
8. restarts services through pm2 only when the scope requires it (`pm2 restart smart-control-backend` for backend-only; `pm2 restart smart-control-backend smart-control-frontend` for full deploy);
9. requires the authoritative deployment verifier and verifies process ownership, freshness, health, and restart stability;
10. restores the previous commit and build artifacts if deployment fails, and retains the newest three verified rollback snapshots;
11. writes deployment logs and JSON audit records under `D:\smart-control\logs`.

The jump-host forced command and the Windows dispatcher only validate and forward the requested action. They must not inspect, clean, or mutate the repository; conflict handling belongs exclusively to the versioned deployment script above.

The workflow does not print or export `.env`, database content, or hardware credentials. It invokes the existing local backup script before replacement, so the protected production backup remains on GK9000. It does not expose the Windows LAN through WireGuard.

## Troubleshooting

- **`Test-Path: parameter 'Path' is null` during restart** — the double-hop non-interactive SSH session (GitHub → Aliyun → WireGuard → GK9000) does **not** populate `$env:APPDATA` (nor `$env:USERPROFILE`). Never build the pm2 path from it. `Restart-Services` in `scripts/deploy-from-ci.ps1` resolves pm2 from a fixed known location and sets `PM2_HOME` explicitly; do the same in any new script that shells out to pm2 from the CI path.
- **`ERR_PNPM_OUTDATED_LOCKFILE`** — a dependency was added to `package.json` without committing the regenerated `pnpm-lock.yaml`. CI uses `--frozen-lockfile`; regenerate with the pinned pnpm version and commit the lockfile in the same change.

- **Restart step silently no-ops or throws `Path is null`** — a non-ASCII comment in a `.ps1` file. PowerShell 5.1 on Chinese Windows reads `.ps1` as GBK; in a UTF-8 (no BOM) file a non-ASCII comment eats the following newline and merges the next line into the comment, commenting out real code. Keep `scripts/*.ps1` ASCII-only.
