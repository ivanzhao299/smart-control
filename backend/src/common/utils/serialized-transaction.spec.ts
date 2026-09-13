import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { serializedTransaction } from './serialized-transaction';

describe('shared DataSource transaction coordination', () => {
  let db: DataSource;
  beforeEach(async () => {
    db = await new DataSource({ type: 'better-sqlite3', database: ':memory:' }).initialize();
    await db.query('CREATE TABLE writes (id INTEGER PRIMARY KEY)');
  });
  afterEach(async () => { await db.destroy(); });
  it('isolates concurrent callers and continues after rollback', async () => {
    let firstStarted!: () => void, finishFirst!: () => void;
    const started = new Promise<void>(resolve => { firstStarted = resolve; });
    const held = new Promise<void>(resolve => { finishFirst = resolve; });
    const first = serializedTransaction(db, async manager => {
      await manager.query('INSERT INTO writes VALUES (1)');
      firstStarted(); await held;
      throw new Error('first failed');
    });
    await started;
    let secondStarted = false;
    const second = serializedTransaction(db.createEntityManager().connection, async manager => {
      secondStarted = true;
      await manager.query('INSERT INTO writes VALUES (2)');
    });
    await Promise.resolve();
    expect(secondStarted).toBe(false);
    finishFirst();
    expect((await Promise.allSettled([first, second])).map(result => result.status)).toEqual(['rejected', 'fulfilled']);
    expect(await db.query('SELECT id FROM writes')).toEqual([{ id: 2 }]);
    await serializedTransaction(db, async manager => { await manager.query('INSERT INTO writes VALUES (3)'); });
    expect(await db.query('SELECT id FROM writes ORDER BY id')).toEqual([{ id: 2 }, { id: 3 }]);
  });
  it('rejects same-connection nesting rather than deadlocking, then recovers', async () => {
    await expect(serializedTransaction(db, async () => serializedTransaction(db, async () => 1))).rejects.toThrow('reuse the supplied EntityManager');
    expect(await serializedTransaction(db, async () => 2)).toBe(2);
  });
});
