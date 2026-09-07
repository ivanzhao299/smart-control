import { lstatSync } from 'fs';
import { resolve } from 'path';

/** Persistent release hold, distinct from the expiring console-maintenance flag.
 * Prevents new processes; the release controller must separately stop existing writers.
 */
export function assertReleaseNotHeld(projectRoot = resolve(__dirname, '../../../..')): void {
  const marker = resolve(projectRoot, 'RELEASE_HOLD');
  try { lstatSync(marker); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw new Error('Cannot verify release hold; refusing startup');
  }
  throw new Error('RELEASE_HOLD is present; keep services stopped until controlled activation or recovery');
}
