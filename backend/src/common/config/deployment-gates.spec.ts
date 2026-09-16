import { readFileSync } from 'fs';
import { resolve } from 'path';

const repositoryRoot = resolve(__dirname, '../../../..');
const readRepositoryFile = (relativePath: string): string =>
  readFileSync(resolve(repositoryRoot, relativePath), 'utf8');

describe('GK9000 deployment gates', () => {
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
    expect(deploy).toContain("throw 'Required deployment verifier scripts\\verify-deploy.js is missing.'");
  });

  it('reconciles PM2 environment and keeps the previous PWA asset generation', () => {
    const deploy = readRepositoryFile('scripts/deploy-from-ci.ps1');

    expect(deploy).toContain("@('start', $eco, '--env', 'production', '--update-env')");
    expect(deploy).toContain("@('start', $eco, '--env', 'production', '--only', 'smart-control-backend', '--update-env')");
    expect(deploy).toContain('function Copy-PreviousFrontendAssets');
    expect(deploy).toContain('Copy-PreviousFrontendAssets $previousFrontendDist $currentFrontendDist');
    expect(deploy).toContain("Get-ChildItem -Path $legacyDataDir -Filter '*.json.bak'");
  });

  it('runs backend tests in the production validation job before building', () => {
    const workflow = readRepositoryFile('.github/workflows/deploy-gk9000.yml');
    const testPosition = workflow.indexOf('pnpm exec jest --ci --reporters=default');
    const backendBuildPosition = workflow.indexOf('pnpm run build');

    expect(testPosition).toBeGreaterThan(-1);
    expect(testPosition).toBeLessThan(backendBuildPosition);
    expect(workflow).toContain('actions/checkout@v7');
    expect(workflow).toContain('actions/setup-node@v7');
    expect(workflow).toContain('pnpm/action-setup@v6');
  });
});
