import { FSWatcher, readFileSync, watch } from 'fs';
import { basename, dirname } from 'path';

export interface FrontendRelease {
  type: 'frontend_release';
  frontendBuildId: string;
}

/** Watch the directory, not the inode: deployments atomically replace release.json.
 * No polling while idle. Invalid/partial documents never replace the last good release.
 */
export class FrontendReleaseWatcher {
  private watcher?: FSWatcher;
  private debounce?: NodeJS.Timeout;
  private current?: FrontendRelease;
  constructor(
    private readonly path: string,
    private readonly publish: (release: FrontendRelease) => void,
    private readonly warn: (message: string) => void,
  ) {}

  start(): void {
    this.refresh();
    try {
      this.watcher = watch(dirname(this.path), (_event, filename) => {
        if (filename && filename.toString() !== basename(this.path)) return;
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = setTimeout(() => this.refresh(), 100);
        this.debounce.unref?.();
      });
      this.watcher.on('error', error => this.warn(`Frontend release watcher: ${error.message}`));
      this.watcher.unref();
      this.refresh();
    } catch (error) {
      this.warn(`Frontend release watcher unavailable; reconnect still checks release: ${(error as Error).message}`);
    }
  }

  refresh(): FrontendRelease | undefined {
    try {
      const data = JSON.parse(readFileSync(this.path, 'utf8').replace(/^\uFEFF/, ''));
      if (!/^[0-9a-f]{40}$/.test(data.commit ?? '') ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(data.frontendBuildId ?? '') ||
          !Number.isFinite(Date.parse(data.releasedAt))) return this.current;
      if (data.frontendBuildId !== this.current?.frontendBuildId) {
        this.current = { type: 'frontend_release', frontendBuildId: data.frontendBuildId };
        this.publish(this.current);
      }
    } catch { /* An absent/partial manifest is not a successful publication. */ }
    return this.current;
  }

  stop(): void {
    this.watcher?.close();
    if (this.debounce) clearTimeout(this.debounce);
  }
}
