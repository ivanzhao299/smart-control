import { mkdtempSync, writeFileSync, renameSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FrontendReleaseWatcher } from './frontend-release';

describe('verified frontend release notification', () => {
  let root: string;
  let path: string;
  let watcher: FrontendReleaseWatcher;
  const publish = jest.fn();
  const first = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';
  function replace(build: string, commit = 'a'.repeat(40)) {
    writeFileSync(`${path}.tmp`, JSON.stringify({ commit, frontendBuildId: build, releasedAt: new Date().toISOString() }));
    renameSync(`${path}.tmp`, path);
  }
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sc-release-test-'));
    path = join(root, 'release.json');
    publish.mockClear();
    watcher = new FrontendReleaseWatcher(path, publish, jest.fn());
  });
  afterEach(() => { watcher.stop(); rmSync(root, { recursive: true, force: true }); });
  it('ignores builds until the verified manifest is published, and deduplicates backend-only releases', () => {
    writeFileSync(join(root, 'deployment-version.json'), JSON.stringify({ frontendBuildId: first }));
    expect(watcher.refresh()).toBeUndefined();
    replace(first); watcher.refresh(); watcher.refresh();
    replace(first, 'b'.repeat(40)); watcher.refresh();
    expect(publish).toHaveBeenCalledTimes(1);
    writeFileSync(path, '{partial');
    expect(watcher.refresh()?.frontendBuildId).toBe(first);
    replace(second); watcher.refresh();
    expect(publish).toHaveBeenCalledTimes(2);
  });
  it('receives repeated atomic replacements and reconnect reads without any polling interval', async () => {
    watcher.start();
    const waitFor = async (count: number) => {
      for (let n = 0; n < 50 && publish.mock.calls.length < count; n++) await new Promise(r => setTimeout(r, 20));
      expect(publish).toHaveBeenCalledTimes(count);
    };
    replace(first); await waitFor(1);
    replace(second); await waitFor(2);
    expect(watcher.refresh()?.frontendBuildId).toBe(second);
    watcher.stop();
    replace(first);
    expect(watcher.refresh()?.frontendBuildId).toBe(first);
  });
});
