import type { Actor } from './actor';
import { canReadResource, assertWriteResource, assertCanUpload, assertCanPublish } from './resource-policy';

describe('resource authorization matrix', () => {
  const alice: Actor = { kind: 'user', userId: 1, username: 'alice', role: 'operator' };
  const bob: Actor = { ...alice, userId: 2, username: 'bob' };
  const admin: Actor = { kind: 'admin', userId: null, username: 'admin', role: 'admin' };
  const privateFile = { ownerUserId: 1, visibility: 'private' as const };
  const sharedFile = { ownerUserId: 1, visibility: 'shared' as const };

  it('isolates another user on reads, writes, and publishing', () => {
    expect(canReadResource(bob, privateFile)).toBe(false);
    expect(() => assertWriteResource(bob, privateFile)).toThrow();
    expect(() => assertCanPublish(bob, privateFile)).toThrow();
    expect(() => assertWriteResource(alice, privateFile)).not.toThrow();
    expect(() => assertCanPublish(alice, privateFile)).not.toThrow();
  });
  it('permits shared playback but reserves shared editing to admins', () => {
    expect(() => assertCanPublish(bob, sharedFile)).not.toThrow();
    expect(() => assertWriteResource(alice, sharedFile)).toThrow();
    expect(() => assertWriteResource(admin, sharedFile)).not.toThrow();
    expect(() => assertWriteResource(admin, privateFile)).not.toThrow();
  });
  it('viewers and legacy sessions cannot upload, modify or push', () => {
    for (const actor of [{ ...alice, role: 'viewer' as const },
      { kind: 'legacy' as const, userId: null, username: 'legacy', role: 'viewer' as const }]) {
      expect(() => assertCanUpload(actor)).toThrow();
      expect(() => assertWriteResource(actor, sharedFile)).toThrow();
      expect(() => assertCanPublish(actor, sharedFile)).toThrow();
    }
  });
  it('null-owned private resources are not implicitly public', () => {
    expect(canReadResource(alice, { ownerUserId: null, visibility: 'private' })).toBe(false);
    expect(canReadResource(admin, { ownerUserId: null, visibility: 'private' })).toBe(true);
  });
});

describe('2026-10-16 least-privilege additions', () => {
  const alice: Actor = { kind: 'user', userId: 1, username: 'alice', role: 'operator' };
  const hardware: Actor = { kind: 'user', userId: 4, username: 'hw', role: 'hardware' };
  const config: Actor = { kind: 'user', userId: 5, username: 'cfg', role: 'config' };
  // operator 角色但来自 legacy 共享令牌（无 userId）：不能当作个人账号上传/管理。
  const operatorLegacy: Actor = { kind: 'legacy', userId: null, username: 'kiosk', role: 'operator' };
  const privateFile = { ownerUserId: 1, visibility: 'private' as const };
  const sharedFile = { ownerUserId: 1, visibility: 'shared' as const };

  it('hardware/config accounts cannot upload or manage media', () => {
    for (const actor of [hardware, config]) {
      expect(() => assertCanUpload(actor)).toThrow();
      expect(() => assertWriteResource(actor, privateFile)).toThrow();
      expect(() => assertWriteResource(actor, sharedFile)).toThrow();
      expect(() => assertCanPublish(actor, sharedFile)).toThrow();
    }
  });

  it('operator legacy token is treated as non-personal (cannot upload/manage)', () => {
    expect(() => assertCanUpload(operatorLegacy)).toThrow();
    expect(() => assertWriteResource(operatorLegacy, privateFile)).toThrow();
    expect(() => assertWriteResource(operatorLegacy, sharedFile)).toThrow();
  });

  it('operator personal can manage own private but not own shared or others private', () => {
    expect(() => assertWriteResource(alice, privateFile)).not.toThrow();
    expect(() => assertWriteResource(alice, sharedFile)).toThrow();
  });
});
