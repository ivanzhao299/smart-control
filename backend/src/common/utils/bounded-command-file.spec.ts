import { boundedCommandFile } from './bounded-command-file';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('bounded child output files', () => {
  let root: string;
  beforeEach(async () => { root = await fs.mkdtemp(join(tmpdir(), 'sc-bounded-output-')); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
  it('writes exact-budget bytes and rejects overflow without writing beyond the cap', async () => {
    const exact = join(root, 'exact');
    await boundedCommandFile(process.execPath, ['-e', 'process.stdout.write(Buffer.alloc(100,65))'], exact, 100);
    expect(await fs.readFile(exact)).toEqual(Buffer.alloc(100, 65));
    const overflow = join(root, 'overflow');
    await expect(boundedCommandFile(process.execPath, ['-e', 'setInterval(()=>process.stdout.write(Buffer.alloc(1024)),1)'], overflow, 1500)).rejects.toThrow('超过容量');
    expect((await fs.stat(overflow)).size).toBeLessThanOrEqual(1500);
  });
  it('never replaces an existing output and rejects an invalid limit', async () => {
    const target = join(root, 'existing');
    await fs.writeFile(target, 'preserved');
    await expect(boundedCommandFile(process.execPath, ['-e', 'process.stdout.write("replacement")'], target, 100)).rejects.toThrow();
    expect(await fs.readFile(target, 'utf8')).toBe('preserved');
    await expect(boundedCommandFile(process.execPath, [], join(root, 'invalid'), -1)).rejects.toThrow('无效');
    await expect(fs.access(join(root, 'invalid'))).rejects.toThrow();
  });
  it('reports a failed encoder even when some stdout was produced', async () => {
    await expect(boundedCommandFile(process.execPath, ['-e', 'process.stdout.write("partial");process.exitCode=2'], join(root, 'failed'), 100)).rejects.toThrow('转码失败');
  });
});
