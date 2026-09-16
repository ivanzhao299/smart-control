const RECOVERY_KEY = 'sc.pwa.chunk-recovery-at';
const RECOVERY_COOLDOWN_MS = 30_000;

export function isStalePwaAssetError(error: unknown): boolean {
  const message = String((error as Error)?.message ?? error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|ChunkLoadError|MIME type.*(?:text\/html|application\/json)|Expected a JavaScript(?:-or-Wasm)? module script/i.test(message);
}

function recoveryTarget(path = window.location.href): string {
  const url = new URL(path, window.location.href);
  url.searchParams.set('__pwa_recover', Date.now().toString(36));
  return url.toString();
}

/** Clear only this application's generated static caches and request a fresh shell. */
export async function recoverFromStalePwa(path?: string): Promise<boolean> {
  const last = Number(sessionStorage.getItem(RECOVERY_KEY) ?? 0);
  if (Date.now() - last < RECOVERY_COOLDOWN_MS) return false;
  sessionStorage.setItem(RECOVERY_KEY, String(Date.now()));

  try {
    if ('serviceWorker' in navigator) {
      const basePath = new URL(import.meta.env.BASE_URL, window.location.origin).pathname;
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations
        .filter((registration) => new URL(registration.scope).pathname.startsWith(basePath))
        .map((registration) => registration.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys
        .filter((key) => key.startsWith('workbox-precache-') || key.startsWith('smart-control-'))
        .map((key) => caches.delete(key)));
    }
  } catch {
    // A plain cache-busted navigation still recovers browsers with limited APIs.
  }

  window.location.replace(recoveryTarget(path));
  return true;
}
