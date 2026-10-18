/**
 * PowerCircuitsService —— 电源分区（Floor，域内二级）管理。
 *
 * 重点保“改名对整层生效、绝不产生脏 tab”：
 *   1. 分区 code/中文名分离：改名只改 name，code 永不允许改（回路引用 code）
 *   2. 同域 code 唯一、name 不允许重名；区域不存在 / 名称为空要报错
 *   3. 分区下仍有回路时拒删（必须先改挂，杜绝回路悬空）
 *   4. 字典 ∪ 回路实际：孤儿（回路里出现、字典未登记）以 registered=false 返回，可一键收录
 *   5. 回路保存时若分区未登记，后端自动兜底收录（不阻断保存）
 */
import type { Logger } from 'winston';
import { ConflictException } from '@nestjs/common';
import { PowerCircuitsService } from './power-circuits.service';
import type { PowerFloor } from '../../entities/power-floor.entity';

const fakeLogger = (): Logger =>
  ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

const match = (row: Record<string, unknown>, where: Record<string, unknown>): boolean =>
  Object.entries(where).every(([k, v]) => row[k] === v);

const DOMAINS = [
  { code: 'hall', name: '展贸中心' },
  { code: 'park', name: '园区' },
];

let floorRows: PowerFloor[];
let circuitRows: Array<{ id: number; code: string; name: string; floor: string; domainCode: string; gatewayCode: string | null }>;
let nextFloorId: number;

const mkService = () => {
  floorRows = [];
  circuitRows = [];
  nextFloorId = 100;
  const seed = (id: number, domainCode: string, code: string, name: string, sortOrder: number, enabled = true) => {
    floorRows.push({ id, domainCode, code, name, sortOrder, enabled, createdAt: new Date(), updatedAt: new Date() } as PowerFloor);
  };
  seed(1, 'hall', '1F', '1F', 10);
  seed(2, 'hall', '二台时序', '二台时序', 20);
  // 回路：1F 两条、二台时序一条、以及一个字典未登记的孤儿“时序器”
  circuitRows = [
    { id: 1, code: 'c1', name: '回路1', floor: '1F', domainCode: 'hall', gatewayCode: null },
    { id: 2, code: 'c2', name: '回路2', floor: '1F', domainCode: 'hall', gatewayCode: null },
    { id: 3, code: 'c3', name: '回路3', floor: '二台时序', domainCode: 'hall', gatewayCode: null },
    { id: 4, code: 'c4', name: '回路4', floor: '时序器', domainCode: 'hall', gatewayCode: null },
  ];

  const floorRepo = {
    find: jest.fn(async ({ where = {} }: { where?: Record<string, unknown> }) =>
      floorRows
        .filter((f) => match(f as unknown as Record<string, unknown>, where))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    ),
    findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      floorRows.find((f) => match(f as unknown as Record<string, unknown>, where)) ?? null,
    ),
    create: jest.fn((x: unknown) => ({ ...(x as object) })),
    save: jest.fn(async (x: PowerFloor) => {
      if (x.id) {
        const i = floorRows.findIndex((f) => f.id === x.id);
        if (i >= 0) floorRows[i] = { ...floorRows[i], ...x } as PowerFloor;
        return floorRows[i];
      }
      const row = { ...x, id: nextFloorId++, createdAt: new Date(), updatedAt: new Date() } as PowerFloor;
      floorRows.push(row);
      return row;
    }),
    delete: jest.fn(async ({ id }: { id: number }) => {
      floorRows = floorRows.filter((f) => f.id !== id);
      return { affected: 1 };
    }),
  };
  const domainRepo = {
    findOne: jest.fn(async ({ where: { code } }: { where: { code: string } }) =>
      DOMAINS.find((d) => d.code === code) ?? null,
    ),
    find: jest.fn(async () => DOMAINS),
    count: jest.fn(async () => 0),
    save: jest.fn(async (x: unknown) => x),
    create: jest.fn((x: unknown) => x),
    delete: jest.fn(async () => ({ affected: 1 })),
  };
  const circuitRepo = {
    find: jest.fn(async () => circuitRows.map((c) => ({ domainCode: c.domainCode, floor: c.floor }))),
    findOne: jest.fn(async ({ where: { code } }: { where: { code: string } }) =>
      circuitRows.find((c) => c.code === code) ?? null,
    ),
    count: jest.fn(
      async ({ where: { domainCode, floor } }: { where: { domainCode: string; floor: string } }) =>
        circuitRows.filter((c) => c.domainCode === domainCode && c.floor === floor).length,
    ),
    create: jest.fn((x: unknown) => ({ ...(x as object) })),
    save: jest.fn(async (x: (typeof circuitRows)[number]) => {
      circuitRows.push(x);
      return x;
    }),
  };
  const svc = new PowerCircuitsService(
    circuitRepo as never,
    domainRepo as never,
    floorRepo as never,
    { find: jest.fn(async () => []), findOne: jest.fn(async () => null) } as never,
    { circuitReadStatus: jest.fn(async () => ({ ok: false })) } as never,
    {} as never,
    {} as never,
    fakeLogger(),
    undefined,
    undefined,
  );
  return { svc };
};

describe('PowerCircuitsService · 分区(Floor)管理', () => {
  it('createFloor：区域不存在/名称为空报错；正常新建自动生成 code 且 ≤16 字符', async () => {
    const { svc } = mkService();
    await expect(svc.createFloor({ domainCode: 'nope', name: 'X' })).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.createFloor({ domainCode: 'hall', name: '  ' })).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.createFloor({ domainCode: 'hall', name: '' })).rejects.toBeInstanceOf(ConflictException);

    const created = await svc.createFloor({ domainCode: 'hall', name: '三楼主展区' });
    expect(created.code).toMatch(/^f/);
    expect(created.code.length).toBeLessThanOrEqual(16);
    expect(created.name).toBe('三楼主展区');
    expect(created.enabled).toBe(true);
    expect(created.registered).toBe(true);
  });

  it('createFloor：同域中文名不允许重名', async () => {
    const { svc } = mkService();
    await expect(svc.createFloor({ domainCode: 'hall', name: '1F' })).rejects.toBeInstanceOf(ConflictException);
    // 不同域可以同名
    const park = await svc.createFloor({ domainCode: 'park', name: '1F' });
    expect(park.domainCode).toBe('park');
  });

  it('updateFloor：改名只改 name，code 永不允许变（整层跟随、不产生新 tab）', async () => {
    const { svc } = mkService();
    const updated = await svc.updateFloor(1, { name: '一楼大堂', code: 'HACKED-CODE' });
    expect(updated.name).toBe('一楼大堂');
    expect(updated.code).toBe('1F');
  });

  it('removeFloor：分区下仍有回路时拒删', async () => {
    const { svc } = mkService();
    // 1F 下有 2 条回路
    await expect(svc.removeFloor(1)).rejects.toBeInstanceOf(ConflictException);
    // 新建一个无回路的分区可删
    const empty = await svc.createFloor({ domainCode: 'hall', name: '备用分区' });
    await svc.removeFloor(empty.id);
    const again = await svc.listFloors({ domainCode: 'hall' });
    expect(again.find((f) => f.id === empty.id)).toBeUndefined();
  });

  it('listFloors：默认仅启用、按 sortOrder 排序、可按域过滤', async () => {
    const { svc } = mkService();
    await svc.updateFloor(2, { enabled: false });
    const hall = await svc.listFloors({ domainCode: 'hall' });
    expect(hall.map((f) => f.code)).toEqual(['1F']);
    const hallAll = await svc.listFloors({ domainCode: 'hall', includeDisabled: true });
    expect(hallAll.map((f) => f.code)).toEqual(['1F', '二台时序']);
  });

  it('listFloorsForAdmin：字典 ∪ 回路实际，孤儿以 registered=false 返回并可一键收录', async () => {
    const { svc } = mkService();
    const managed = await svc.listFloorsForAdmin({ domainCode: 'hall' });
    const orphan = managed.find((f) => f.code === '时序器');
    expect(orphan).toBeDefined();
    expect(orphan?.registered).toBe(false);
    expect(orphan?.circuitCount).toBe(1);

    // 收录孤儿（沿用回路里的 code）
    await svc.createFloor({ domainCode: 'hall', code: '时序器', name: '时序器（主机柜）' });
    const after = await svc.listFloorsForAdmin({ domainCode: 'hall' });
    const adopted = after.find((f) => f.code === '时序器');
    expect(adopted?.registered).toBe(true);
    expect(adopted?.name).toBe('时序器（主机柜）');
    // 孤儿不应再重复出现（字典与回路并集去重）
    expect(after.filter((f) => f.code === '时序器')).toHaveLength(1);
  });

  it('回路保存兜底：新建回路指向未登记分区时自动收录，不阻断保存', async () => {
    const { svc } = mkService();
    await svc.create({
      code: 'c-new',
      name: '新回路',
      floor: '屋顶花园',
      domainCode: 'hall',
      category: 'relay',
      enabled: true,
    } as never);
    const managed = await svc.listFloorsForAdmin({ domainCode: 'hall' });
    const auto = managed.find((f) => f.code === '屋顶花园');
    expect(auto).toBeDefined();
    expect(auto?.registered).toBe(true);
  });
});
