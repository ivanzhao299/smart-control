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
    expect(workflow).not.toContain('git push origin HEAD:main && exit 0');
    expect(workflow).toContain(
      'B8E4BCFCE594FB84C1280BA7C260A767492D747CA86CA0DD51A577CCE1870D04',
    );
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
    expect(supplyChain).toContain(
      'anchore/sbom-action@3ad7283483fc7af8ff2b4ea19663c2d5ca935e26',
    );
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
      ['grep', '-h', '-E', 'uses: (actions/(checkout|setup-node|upload-artifact|download-artifact)|pnpm/action-setup)@', '--', '.github/workflows'],
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
