import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { assertReleaseNotHeld } from './release-hold';

describe('persistent release hold', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'sc-release-hold-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });
  it('allows an absent hold without creating files', () => {
    expect(() => assertReleaseNotHeld(root)).not.toThrow();
  });
  it.each(['file', 'directory', 'old', 'dangling-link'])('refuses a %s hold without expiring or removing it', kind => {
    const marker = join(root, 'RELEASE_HOLD');
    if (kind === 'directory') mkdirSync(marker);
    else if (kind === 'dangling-link') symlinkSync(join(root, 'missing'), marker);
    else {
      writeFileSync(marker, 'release in progress');
      if (kind === 'old') utimesSync(marker, new Date('2000-01-01'), new Date('2000-01-01'));
    }
    expect(() => assertReleaseNotHeld(root)).toThrow('RELEASE_HOLD is present');
    expect(() => assertReleaseNotHeld(root)).toThrow('RELEASE_HOLD is present');
  });
});
