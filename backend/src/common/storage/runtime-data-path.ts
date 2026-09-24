import { existsSync, mkdirSync } from 'fs';
import { basename, dirname, resolve } from 'path';

/**
 * Resolve mutable runtime documents outside the Git worktree.
 *
 * DATA_DIR remains the authoritative override. The Windows production fallback
 * is intentionally fixed so a PM2 environment regression cannot silently send
 * writes back into backend/data and make operator edits appear to disappear.
 */
export function resolveRuntimeDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  cwd: string = process.cwd(),
): string {
  const configured = env.DATA_DIR?.trim();
  if (configured) return resolve(configured);
  if (platform === 'win32') return 'D:\\smart-control-runtime\\data';

  const projectRoot = basename(cwd).toLowerCase() === 'backend' ? dirname(cwd) : cwd;
  return resolve(projectRoot, '.runtime', 'data');
}

export function ensureRuntimeDataDir(): string {
  const dataDir = resolveRuntimeDataDir();
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  return dataDir;
}
