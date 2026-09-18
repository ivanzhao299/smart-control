/** Local-only original photo cache. No credential or original is sent to a server. */
export interface StoredWelcomeOriginal {
  scope: string;
  mediaId: number;
  ts: number;
  file: File;
}

/** Session-specific digest: a relogin intentionally cannot recover another login's original. */
export async function welcomeOriginalScope(server: string, admin: string | null, client: string | null): Promise<string | null> {
  if (!admin && !client) return null;
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([server, admin, client])));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch { return null; } // HTTP/unsupported crypto: memory-only, never an unscoped fallback.
}

const STORE = 'welcomePhoto';
const KEY = 'original';
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('smart-control', 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Guard both opening and transaction callbacks; old unscoped rows are never returned. */
export async function readWelcomeOriginal(scope: string | null, active: () => boolean): Promise<StoredWelcomeOriginal | null> {
  if (!scope || !active()) return null;
  let db: IDBDatabase | undefined;
  try {
    db = await open();
    if (!active()) return null;
    const result = await new Promise<StoredWelcomeOriginal | undefined>((resolve, reject) => {
      const tx = db!.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return active() && result?.scope === scope ? result : null;
  } catch { return null; }
  finally { db?.close(); }
}

export async function writeWelcomeOriginal(value: StoredWelcomeOriginal, active: () => boolean): Promise<void> {
  if (!active()) return;
  let db: IDBDatabase | undefined;
  try {
    db = await open();
    if (!active()) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch { /* A failed local cache must not undo a confirmed server binding. */ }
  finally { db?.close(); }
}

/** Compare-and-delete in one transaction; a late removal cannot erase a newer original. */
export async function removeWelcomeOriginal(scope: string | null, mediaId: number, active: () => boolean): Promise<void> {
  if (!scope || !active()) return;
  let db: IDBDatabase | undefined;
  try {
    db = await open();
    if (!active()) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const request = store.get(KEY);
      request.onsuccess = () => {
        const current = request.result as StoredWelcomeOriginal | undefined;
        if (active() && current?.scope === scope && current.mediaId === mediaId) store.delete(KEY);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch { /* Local cleanup can be retried without touching another scope. */ }
  finally { db?.close(); }
}
