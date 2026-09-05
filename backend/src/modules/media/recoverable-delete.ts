import { promises as fs } from 'fs';
import { join } from 'path';

/** Stage only an exact numeric asset directory; never follow a directory symlink. */
export async function recoverableDelete(root: string, id: number, commit: () => Promise<unknown>): Promise<{ cleanupPending: boolean }> {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid media ID');
  const original = join(root, String(id));
  const stat = await fs.lstat(original).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!stat) { await commit(); return { cleanupPending: false }; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid asset directory');
  const quarantine = await fs.mkdtemp(join(root, `.delete-${id}-`));
  const staged = join(quarantine, 'files');
  try { await fs.rename(original, staged); }
  catch (error) { await fs.rmdir(quarantine); throw error; }
  try { await commit(); }
  catch (error) {
    // Never overwrite a newly recreated directory while restoring.
    const occupied = await fs.lstat(original).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; });
    if (occupied) throw new Error('删除失败且原位置被占用，文件保留在隔离目录，需恢复检查');
    await fs.rename(staged, original);
    await fs.rmdir(quarantine);
    throw error;
  }
  try { await fs.rm(quarantine, { recursive: true, force: false }); return { cleanupPending: false }; }
  catch { return { cleanupPending: true }; }
}
