import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';

/** Write child stdout with backpressure and a hard byte cap, never a shell. */
export async function boundedCommandFile(command: string, args: string[], output: string, maxBytes: number): Promise<void> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('无效转码输出容量限制');
  const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { if (stderr.length < 8000) stderr += chunk.toString(); });
  const completion = new Promise<{ code?: number | null; error?: Error }>(resolve => {
    child.once('error', error => resolve({ error }));
    child.once('close', code => resolve({ code }));
  });
  let written = 0;
  const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    if (chunk.length > maxBytes - written) return callback(new Error('转码输出超过容量预算'));
    written += chunk.length;
    callback(null, chunk);
  } });
  try {
    await pipeline(child.stdout, limit, createWriteStream(output, { flags: 'wx', mode: 0o600 }));
  } catch (error) {
    child.kill('SIGKILL');
    await completion;
    throw error;
  }
  const result = await completion;
  if (result.error) throw result.error;
  if (result.code !== 0) throw new Error(`转码失败 (${result.code}): ${stderr.slice(-2000)}`);
}
