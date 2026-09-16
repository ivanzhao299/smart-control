import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { execFileSync } from 'child_process';

const repositoryRoot = resolve(__dirname, '../../../..');
const readRepositoryFile = (relativePath: string): string =>
  readFileSync(resolve(repositoryRoot, relativePath), 'utf8');

describe('GK9000 deployment gates', () => {
  it('uses one SQLite driver and keeps the legacy native driver out of the lockfile', () => {
    const packageJson = JSON.parse(readRepositoryFile('backend/package.json')) as {
      dependencies: Record<string, string>;
    };
    const lockfile = readRepositoryFile('backend/pnpm-lock.yaml');

    expect(packageJson.dependencies['better-sqlite3']).toBeDefined();
    expect(packageJson.dependencies.sqlite3).toBeUndefined();
    expect(lockfile).not.toMatch(/^  sqlite3@\d/m);
  });

  it('uses one pnpm version source for frontend installs', () => {
    const backendPackage = JSON.parse(readRepositoryFile('backend/package.json')) as {
      packageManager: string;
    };
    const frontendPackage = JSON.parse(readRepositoryFile('frontend/package.json')) as {
      packageManager: string;
    };

    expect(frontendPackage.packageManager).toBe(backendPackage.packageManager);
    expect(frontendPackage.packageManager).toBe('pnpm@10.33.4');
    expect(existsSync(resolve(repositoryRoot, 'frontend/package-lock.json'))).toBe(false);
    for (const script of [
      'scripts/start.ps1',
      'scripts/restart.ps1',
      'scripts/update.ps1',
      'scripts/start-prod.sh',
      'scripts/start-dev.sh',
    ]) {
      const source = readRepositoryFile(script);
      expect(source).not.toContain('npm ci');
      expect(source).not.toMatch(/Run "npm run/);
      expect(source).not.toMatch(/^npm run/m);
    }
  });

  it('keeps generated database sidecars and logs out of the version tree', () => {
    const tracked = execFileSync('git', ['ls-files', 'database', 'logs'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(Boolean);

    expect(tracked).toEqual([]);
  });

  it('uses migrations and explicit account provisioning instead of deployment seeds', () => {
    const backendPackage = JSON.parse(readRepositoryFile('backend/package.json')) as {
      scripts: Record<string, string>;
    };
    const update = readRepositoryFile('scripts/update.ps1');
    const init = readRepositoryFile('deploy/scripts/init.ps1');

    expect(backendPackage.scripts.seed).toBeUndefined();
    expect(backendPackage.scripts['seed:dev']).toBeUndefined();
    const liveTrackedSeedFiles = execFileSync('git', ['ls-files', 'backend/src/seed'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(Boolean)
      .filter((file) => existsSync(resolve(repositoryRoot, file)));
    expect(liveTrackedSeedFiles).toEqual([]);
    expect(update).toContain('node scripts/run-migrations.js');
    expect(update).not.toContain('pnpm run seed');
    expect(update).not.toContain('DALI_RTU_HOST=192.168.50.20');
    expect(init).toContain('node scripts/run-migrations.js');
    expect(init).toContain('pnpm run admin:provision');
    expect(init).toContain('$env:SC_ADMIN_USERNAME');
    expect(init).toContain('$env:SC_ADMIN_PASSWORD');
    expect(
      readFileSync(resolve(repositoryRoot, 'deploy/scripts/init.ps1')).subarray(0, 3),
    ).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });

  it('keeps Android release signing material in encrypted CI secrets', () => {
    const trackedSigningFiles = execFileSync('git', ['ls-files', 'android-app/signing'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(Boolean);
    const gradle = readRepositoryFile('android-app/app/build.gradle.kts');
    const workflow = readRepositoryFile('.github/workflows/android-build.yml');

    expect(trackedSigningFiles).toEqual(['android-app/signing/README.md']);
    expect(gradle).not.toContain('signing/internal.p12');
    expect(gradle).not.toContain('jinhu-internal');
    expect(gradle).toContain('ANDROID_SIGNING_STORE_FILE');
    expect(workflow).toContain('secrets.ANDROID_SIGNING_KEYSTORE_BASE64');
    expect(workflow).toContain('Verify release signing certificate');
    expect(workflow).toContain("if: github.ref == 'refs/heads/main'");
    expect(workflow).toContain('actions/checkout@v7');
    expect(workflow).toContain('actions/setup-java@v6');
    expect(workflow).toContain('gradle/actions/setup-gradle@v6');
    expect(workflow).toContain('actions/upload-artifact@v7');
    expect(workflow).toContain('actions: write');
    expect(workflow).toContain('gh workflow run deploy-gk9000.yml --ref main');
    expect(workflow).not.toContain("- '.github/workflows/android-build.yml'");
    expect(workflow).not.toContain('git push origin HEAD:main && exit 0');
    expect(workflow).toContain('B8E4BCFCE594FB84C1280BA7C260A767492D747CA86CA0DD51A577CCE1870D04');
  });

  it('keeps destructive workspace cleanup out of the jump host and dispatcher', () => {
    const jump = readRepositoryFile('deploy/aliyun-gk9000-jump-deploy.sh');
    const dispatcher = readRepositoryFile('deploy/windows-ci-dispatch.ps1');

    expect(jump).not.toContain('gk9000-clean');
    expect(jump).not.toContain('untracked-files');
    expect(jump).not.toContain('Remove-Item');
    expect(dispatcher).not.toContain('git status');
    expect(dispatcher).not.toContain('Remove-Item');
  });

  it('bootstraps each deployment with the script from the requested main commit', () => {
    const dispatcher = readRepositoryFile('deploy/windows-ci-dispatch.ps1');
    const deploy = readRepositoryFile('scripts/deploy-from-ci.ps1');

    expect(dispatcher).toContain('fetch --prune origin main');
    expect(dispatcher).toContain('$attempt -lt 3');
    expect(dispatcher).toContain('merge-base --is-ancestor $Commit origin/main');
    expect(dispatcher).toContain('${Commit}:scripts/deploy-from-ci.ps1');
    expect(dispatcher).toContain('System.Management.Automation.Language.Parser');
    expect(dispatcher).toContain('[IO.File]::Delete($targetScript)');
    expect(deploy).toContain("Join-Path $projectRoot 'deploy\\windows-ci-dispatch.ps1'");
    expect(deploy).toContain('Windows CI dispatcher updated from verified commit');
    expect(deploy).toContain(
      '[IO.File]::Replace($dispatcherTemp, $dispatcherTarget, $dispatcherPrevious)',
    );
    expect(deploy).not.toContain(
      '[IO.File]::Replace($dispatcherTemp, $dispatcherTarget, $null)',
    );
    expect(deploy.indexOf('$dispatcherSource =')).toBeGreaterThan(
      deploy.indexOf("Write-DeployLog 'verify-deploy.js passed.'"),
    );
  });

  it('quarantines only untracked paths that conflict with the target commit', () => {
    const deploy = readRepositoryFile('scripts/deploy-from-ci.ps1');

    expect(deploy).toContain('git cat-file -e');
    expect(deploy).toContain('if (-not $existsInTarget) { continue }');
    expect(deploy).toContain("$quarantineRoot = Join-Path $rollbackRoot 'untracked-conflicts'");
    expect(deploy).toContain('Move-Item -Path $fullPath -Destination $quarantinePath -Force');
    expect(deploy).toContain(
      "throw 'Required deployment verifier scripts\\verify-deploy.js is missing.'",
    );
  });

  it('preserves historically tracked runtime files while removing them from Git', () => {
    const deploy = readRepositoryFile('scripts/deploy-from-ci.ps1');

    expect(deploy).toContain('git diff --diff-filter=D --name-only');
    expect(deploy).toContain('function Test-MutableRuntimePath');
    expect(deploy).toContain('$isMutableRuntime = Test-MutableRuntimePath $path');
    expect(deploy).toContain('Preparing safe runtime untracking for:');
    expect(deploy).toContain("Join-Path $rollbackRoot 'tracked-runtime-untracking'");
    expect(deploy).toContain(
      'Restore-ArchivedRuntimeFiles $runtimeUntrackArchiveRoot $runtimeUntrackPaths',
    );
    expect(deploy).toContain("Join-Path $rollbackRoot 'live-runtime-before-code-rollback'");
    expect(deploy).toContain("Join-Path $rollbackRoot 'stale-tracked-runtime-from-old-commit'");
    expect(deploy).toContain(
      'Using the verified backup created immediately before runtime untracking.',
    );
  });

  it('reconciles PM2 environment and keeps the previous PWA asset generation', () => {
    const deploy = readRepositoryFile('scripts/deploy-from-ci.ps1');

    expect(deploy).toContain("@('start', $eco, '--env', 'production', '--update-env')");
    expect(deploy).toContain(
      "@('start', $eco, '--env', 'production', '--only', 'smart-control-backend', '--update-env')",
    );
    expect(deploy).toContain('function Copy-PreviousFrontendAssets');
    expect(deploy).toContain(
      'Copy-PreviousFrontendAssets $previousFrontendDist $currentFrontendDist',
    );
    expect(deploy).toContain("Get-ChildItem -Path $legacyDataDir -Filter '*.json.bak'");
  });

  it('records the verified release outside the worktree without mutating verify-only runs', () => {
    const deploy = readRepositoryFile('scripts/deploy-from-ci.ps1');
    const manifestGuard = deploy.indexOf('if (-not $VerifyOnly)');
    const manifestWrite = deploy.indexOf("Join-Path $releaseDataDir 'release.json'");

    expect(manifestGuard).toBeGreaterThan(-1);
    expect(manifestWrite).toBeGreaterThan(manifestGuard);
    expect(deploy).toContain('commit = $deployedCommit');
    expect(deploy).toContain(
      '[IO.File]::Replace($releaseManifestTemp, $releaseManifestPath, $releaseManifestPrevious)',
    );
    expect(deploy).not.toContain(
      '[IO.File]::Replace($releaseManifestTemp, $releaseManifestPath, $null)',
    );
    expect(deploy).toContain('Text.UTF8Encoding($false)');
    expect(deploy).toContain('WARNING: release manifest was not recorded');
    expect(deploy).toContain('Never roll back');
  });

  it('reconciles Android release metadata only after production verification', () => {
    const deploy = readRepositoryFile('scripts/deploy-from-ci.ps1');
    const reconciler = readRepositoryFile('backend/scripts/reconcile-app-release.cjs');
    const workflow = readRepositoryFile('.github/workflows/android-build.yml');

    expect(deploy).toContain('function Invoke-AppReleaseReconciliation');
    expect(deploy).toContain('Invoke-AppReleaseReconciliation -CheckOnly');
    expect(deploy).toContain('$appReleaseReconciled = $true');
    expect(deploy.indexOf("Write-DeployLog 'verify-deploy.js passed.'")).toBeLessThan(
      deploy.indexOf("Write-DeployLog 'Reconciling authoritative Android app release metadata.'"),
    );
    expect(deploy.indexOf('Invoke-AppReleaseReconciliation\n')).toBeLessThan(
      deploy.indexOf("$result = 'PASS'"),
    );
    expect(reconciler).toContain('readonly: Boolean(options.checkOnly)');
    expect(reconciler).toContain('db.transaction(inspectOrUpdate).immediate()');
    expect(reconciler).toContain('Bundled Android artifact checksum mismatch');
    expect(reconciler).toContain('Bundled Android artifact is older than the authoritative release');
    expect(workflow).toContain('APK_SHA256=$(sha256sum');
    expect(workflow).toContain('"apkSize": $APK_SIZE');
  });

  it('uses a controlled migration state machine and the real host task inventory', () => {
    const deploy = readRepositoryFile('scripts/deploy-from-ci.ps1');
    const suspend = readRepositoryFile('scripts/suspend-gk9000-release.ps1');
    const assertStopped = readRepositoryFile('scripts/assert-gk9000-writers-stopped.ps1');
    const resume = readRepositoryFile('scripts/resume-gk9000-release.ps1');
    const reconcile = readRepositoryFile('scripts/reconcile-held-gk9000-release.ps1');
    const tasks = readRepositoryFile('scripts/gk9000-release-tasks.ps1');

    expect(deploy).toContain('scripts/run-migrations.js --check-only');
    expect(deploy).toContain('scripts\\run-gk9000-migrations.cjs');
    expect(deploy).toContain('scripts\\suspend-gk9000-release.ps1');
    expect(deploy).toContain('scripts\\resume-gk9000-release.ps1');
    expect(deploy).toContain("$script:migrationState = 'controller-started'");
    expect(deploy.indexOf('$script:migrationAttempted = $true')).toBeGreaterThan(
      deploy.indexOf("$script:migrationState = 'isolated'"),
    );
    expect(deploy).not.toContain('& node scripts/run-migrations.js 2>&1');
    expect(deploy).toContain('-AbortBeforeMigration -Apply');
    expect(suspend).toContain(". (Join-Path $PSScriptRoot 'gk9000-release-tasks.ps1')");
    expect(suspend).toContain('$process.ParentProcessId -in $owners');
    expect(suspend).toContain('$managedExternal += $process');
    expect(assertStopped).toContain('Get-Gk9000ReleaseTasks');
    expect(assertStopped).toContain("throw 'Unexpected migration controller.'");
    expect(assertStopped).toContain('$controllerPid = $controller.ProcessId');
    expect(assertStopped).toContain('reconcile-held-gk9000-release');
    expect(assertStopped).toContain('smart-control-ci-dispatch\\.ps1');
    expect(assertStopped).toContain('$dispatcherMatch.Groups[1].Value -eq $currentRevision');
    expect(deploy).toContain("$pm2FailClosed = 'C:\\Users\\user\\AppData\\Roaming\\npm\\pm2.cmd'");
    expect(deploy).toContain("Invoke-Native $pm2FailClosed @('kill')");
    expect(deploy).toContain(
      "$migrationEntry = Join-Path $projectRoot 'backend\\scripts\\run-gk9000-migrations.cjs'",
    );
    expect(deploy).toContain('$migrationLines = @(& node $migrationEntry');
    expect(resume).toContain("ParameterSetName='Aborted'");
    expect(reconcile).toContain('if (-not $Apply)');
    expect(reconcile).toContain('scripts\\run-gk9000-migrations.cjs');
    expect(reconcile).toContain('scripts\\resume-gk9000-release.ps1');
    expect(reconcile).toContain("$ErrorActionPreference = 'Continue'");
    expect(reconcile).toContain(
      "$migrationEntry = Join-Path $root 'backend\\scripts\\run-gk9000-migrations.cjs'",
    );
    expect(reconcile.indexOf('run-gk9000-migrations.cjs')).toBeLessThan(
      reconcile.indexOf('resume-gk9000-release.ps1'),
    );
    expect(tasks).toContain('$script:Gk9000RequiredReleaseTasks');
    expect(tasks).toContain("$script:Gk9000OptionalReleaseTasks = @('SmartControlFrontend')");
  });

  it('advances a held migration only across the generated Android artifact commit', () => {
    const advance = readRepositoryFile('scripts/advance-held-gk9000-app-release.ps1');
    const deployWorkflow = readRepositoryFile('.github/workflows/deploy-gk9000.yml');

    expect(deployWorkflow).toContain("- 'android-app/**'");
    expect(advance).toContain("'deploy/assets/app/manifest.json'");
    expect(advance).toContain("'deploy/assets/app/smart-control-latest.apk'");
    expect(advance).toContain('Compare-Object $allowedPaths $changedPaths');
    expect(advance).toContain('merge-base --is-ancestor $previousCandidate $Commit');
    expect(advance).toContain('verify-gk9000-migration-receipt.cjs');
    expect(advance).toContain('git -C $root merge --ff-only $Commit');
    expect(advance).toContain('scripts\\reconcile-app-release.cjs');
    expect(advance).toContain('migration-complete-advanced-{0}.json');
    expect(advance).toContain('resume-gk9000-release.ps1');
    expect(advance).toContain('if (-not $Apply)');
    expect(advance.indexOf('verify-gk9000-migration-receipt.cjs')).toBeLessThan(
      advance.indexOf('git -C $root merge --ff-only $Commit'),
    );
    expect(advance.indexOf('scripts\\reconcile-app-release.cjs')).toBeLessThan(
      advance.indexOf('resume-gk9000-release.ps1'),
    );
  });

  it('runs backend tests in the production validation job before building', () => {
    const workflow = readRepositoryFile('.github/workflows/deploy-gk9000.yml');
    const auditPosition = workflow.indexOf('pnpm audit --prod --audit-level high');
    const testPosition = workflow.indexOf('pnpm exec jest --ci --reporters=default');
    const backendBuildPosition = workflow.indexOf('pnpm run build');
    const frontendAuditPosition = workflow.indexOf(
      'pnpm audit --prod --audit-level high',
      auditPosition + 1,
    );
    const frontendTestPosition = workflow.indexOf('pnpm run test');
    const frontendTypecheckPosition = workflow.indexOf('pnpm run typecheck');
    const frontendBuildPosition = workflow.indexOf('pnpm run build', backendBuildPosition + 1);

    expect(auditPosition).toBeGreaterThan(-1);
    expect(auditPosition).toBeLessThan(testPosition);
    expect(testPosition).toBeGreaterThan(-1);
    expect(testPosition).toBeLessThan(backendBuildPosition);
    expect(frontendAuditPosition).toBeGreaterThan(backendBuildPosition);
    expect(frontendAuditPosition).toBeLessThan(frontendTestPosition);
    expect(frontendTestPosition).toBeGreaterThan(backendBuildPosition);
    expect(frontendTestPosition).toBeLessThan(frontendTypecheckPosition);
    expect(frontendTypecheckPosition).toBeLessThan(frontendBuildPosition);
    expect(workflow).toContain('actions/checkout@v7');
    expect(workflow).toContain('actions/setup-node@v7');
    expect(workflow).toContain('pnpm/action-setup@v6');
    expect(readRepositoryFile('.github/workflows/ci.yml')).toContain(
      'pnpm audit --prod --audit-level high',
    );
  });

  it('publishes validated production SBOMs without redeploying workflow-only changes', () => {
    const supplyChain = readRepositoryFile('.github/workflows/software-supply-chain.yml');
    const syftConfig = readRepositoryFile('tools/ci/syft-production.yaml');
    const dependabot = readRepositoryFile('.github/dependabot.yml');
    const deployWorkflow = readRepositoryFile('.github/workflows/deploy-gk9000.yml');

    expect(supplyChain).toContain('pnpm install --frozen-lockfile --prod --ignore-scripts');
    expect(supplyChain).toContain('anchore/sbom-action@3ad7283483fc7af8ff2b4ea19663c2d5ca935e26');
    expect(supplyChain).toContain('syft-version: v1.51.1');
    expect(supplyChain).toContain('github.event.pull_request.head.sha || github.sha');
    expect(supplyChain).toContain('Validate SBOM completeness and provenance');
    expect(supplyChain).toContain('if-no-files-found: error');
    expect(syftConfig).toContain('-javascript-lock-cataloger');
    expect(syftConfig).toContain('-github-actions-usage-cataloger');
    expect(dependabot).toContain('interval: weekly');
    expect(dependabot).not.toContain('automerge');
    expect(deployWorkflow).toContain("- '.github/**'");
    expect(deployWorkflow).toContain("- 'docs/**'");
    expect(deployWorkflow).toContain("- 'backend/**/*.spec.ts'");
    expect(deployWorkflow).toContain("- 'frontend/tests/**'");
    expect(deployWorkflow).toContain("- 'tools/ci/**'");

    const iosWorkflow = readRepositoryFile('.github/workflows/ios-build.yml');
    const iosPushBlock = iosWorkflow.slice(
      iosWorkflow.indexOf('  push:'),
      iosWorkflow.indexOf('  pull_request:'),
    );
    expect(iosPushBlock).toContain("- 'ios-app/**'");
    expect(iosPushBlock).not.toContain('.github/workflows/ios-build.yml');
    expect(iosWorkflow).toContain("github.event_name == 'workflow_dispatch'");

    const workflows = execFileSync(
      'git',
      [
        'grep',
        '-h',
        '-E',
        'uses: (actions/(checkout|setup-node|upload-artifact|download-artifact)|pnpm/action-setup)@',
        '--',
        '.github/workflows',
      ],
      { cwd: repositoryRoot, encoding: 'utf8' },
    );
    expect(workflows).not.toMatch(/@(v4|v5)\b/);
  });

  it('keeps production verification truthful and read only', () => {
    const verify = readRepositoryFile('scripts/verify-deploy.js');

    expect(verify).toContain('VERIFY_CLIENT_TOKEN');
    expect(verify).toContain('SKIP 未配置 VERIFY_CLIENT_TOKEN');
    expect(verify).toContain('new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true })');
    expect(verify).toContain("db.pragma('query_only = ON')");
    expect(verify).toContain("path.join(ROOT, 'database', 'smart-control.db')");
    expect(verify).toContain('candidates.find((candidate) => fs.existsSync(candidate))');
    expect(verify).toContain('expectedPidToName.get(pid)');
    expect(verify).toContain("cmd.includes('verify-deploy.js')");
  });
});
