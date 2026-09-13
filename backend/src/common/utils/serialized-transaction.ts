import { AsyncLocalStorage } from 'async_hooks';
import { DataSource, EntityManager } from 'typeorm';

// SQLite has one query runner per DataSource. Separate service managers must use
// the same queue or their async BEGIN/savepoint/rollback operations can interleave.
const tails = new WeakMap<DataSource, Promise<void>>();
const context = new AsyncLocalStorage<ReadonlySet<DataSource>>();

export async function serializedTransaction<T>(
  db: DataSource, work: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  if (context.getStore()?.has(db)) throw new Error('Nested coordinated transaction: reuse the supplied EntityManager');
  const previous = tails.get(db) ?? Promise.resolve();
  let release!: () => void;
  const tail = new Promise<void>(resolve => { release = resolve; });
  tails.set(db, tail);
  await previous;
  try {
    const active = new Set(context.getStore() ?? []);
    active.add(db);
    return await context.run(active, () => db.transaction(work));
  } finally {
    release();
    if (tails.get(db) === tail) tails.delete(db);
  }
}
