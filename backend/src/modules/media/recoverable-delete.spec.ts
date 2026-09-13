import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { recoverableDelete } from './recoverable-delete';

describe('recoverable file deletion', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'sc-delete-test-'));
    await fs.mkdir(join(root, '7'));
    await fs.writeFile(join(root, '7', 'private.txt'), 'private bytes');
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
  it('stages files before commit and removes only that directory after success', async () => {
    await fs.mkdir(join(root, '8'));
    const commit = jest.fn(async () => {
      await expect(fs.stat(join(root, '7'))).rejects.toMatchObject({ code: 'ENOENT' });
      const quarantine = (await fs.readdir(root)).find(name => name.startsWith('.delete-7-'))!;
      expect(await fs.readFile(join(root, quarantine, 'files', 'private.txt'), 'utf8')).toBe('private bytes');
    });
    expect(await recoverableDelete(root, 7, commit)).toEqual({ cleanupPending: false });
    expect(await fs.readdir(root)).toEqual(['8']);
    expect(commit).toHaveBeenCalledTimes(1);
  });
  it('restores exact original bytes if database deletion fails', async () => {
    await expect(recoverableDelete(root, 7, async () => { throw new Error('database rejected'); })).rejects.toThrow('database rejected');
    expect(await fs.readFile(join(root, '7', 'private.txt'), 'utf8')).toBe('private bytes');
    expect(await fs.readdir(root)).toEqual(['7']);
  });
  it('never overwrites a recreated directory during rollback', async () => {
    await expect(recoverableDelete(root, 7, async () => {
      await fs.mkdir(join(root, '7')); await fs.writeFile(join(root, '7', 'new.txt'), 'new');
      throw new Error('database rejected');
    })).rejects.toThrow('原位置被占用');
    const quarantine = (await fs.readdir(root)).find(name => name.startsWith('.delete-7-'))!;
    expect(await fs.readFile(join(root, quarantine, 'files', 'private.txt'), 'utf8')).toBe('private bytes');
    expect(await fs.readFile(join(root, '7', 'new.txt'), 'utf8')).toBe('new');
  });
  it('rejects symlink directories without committing', async () => {
    await fs.symlink(join(root, '7'), join(root, '9'));
    const commit = jest.fn();
    await expect(recoverableDelete(root, 9, commit)).rejects.toThrow('Invalid asset directory');
    expect(commit).not.toHaveBeenCalled();
  });
  it('supports a database-only webpage without creating trash', async () => {
    const commit = jest.fn(async () => undefined);
    await recoverableDelete(root, 10, commit);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(await fs.readdir(root)).toEqual(['7']);
  });
  it('reports retained quarantine when post-commit cleanup fails', async () => {
    const removal = jest.spyOn(fs, 'rm').mockRejectedValueOnce(new Error('file locked'));
    try {
      expect(await recoverableDelete(root, 7, async () => undefined)).toEqual({ cleanupPending: true });
      const quarantine = (await fs.readdir(root)).find(name => name.startsWith('.delete-7-'))!;
      expect(await fs.readFile(join(root, quarantine, 'files', 'private.txt'), 'utf8')).toBe('private bytes');
    } finally { removal.mockRestore(); }
  });
});
