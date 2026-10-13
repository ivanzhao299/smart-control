import { DataSource } from 'typeorm';
import { mkdtempSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LprDevice } from '../../entities/lpr-device.entity';
import { LprPassRecord } from '../../entities/lpr-pass-record.entity';
import { LprWhitelist } from '../../entities/lpr-whitelist.entity';
import { LprGateEvent } from '../../entities/lpr-gate-event.entity';
import { LprPlatformConfig } from '../../entities/lpr-platform-config.entity';
import { ControlBus } from '../../services/control-bus';
import { AuditService } from '../audit/audit.service';
import { LprService } from './lpr.service';
import { normalizePlate, plateTypeLabel, gateStatusLabel } from './lpr-codes';
import type { AlarmPlateBody } from './lpr.types';

const ENTITIES = [LprDevice, LprPassRecord, LprWhitelist, LprGateEvent, LprPlatformConfig];

function plateBody(over: Record<string, unknown> = {}, serialno = 'SN001'): AlarmPlateBody {
  return {
    AlarmInfoPlate: {
      serialno,
      channel: 1,
      result: {
        PlateResult: {
          license: '鲁Q12345',
          plateid: 'p-1',
          serialno,
          type: 1,
          colorType: 1,
          carColor: 0,
          confidence: 95,
          triggerType: 1,
          direction: 1,
          isoffline: 0,
          is_fake_plate: 0,
          is_danger: 0,
          timeStamp: { Timeval: { sec: Math.floor(Date.now() / 1000) } },
          ...over,
        },
      },
    },
  };
}

describe('lpr-codes 码表', () => {
  it('规范化车牌: 去空格/点/遮挡并大写', () => {
    expect(normalizePlate(' 鲁q·12345 ')).toBe('鲁Q12345');
    expect(normalizePlate('京A**12')).toBe('京A12');
    expect(normalizePlate(null)).toBe('');
  });

  it('码表映射与未知回退', () => {
    expect(plateTypeLabel(1)).toBe('蓝牌小汽车');
    expect(plateTypeLabel(99)).toBe('未知(99)');
    expect(plateTypeLabel(null)).toBeNull();
    expect(gateStatusLabel(1)).toBe('开到位');
  });
});

describe('LprService', () => {
  let ds: DataSource;
  let service: LprService;
  let bus: ControlBus;
  const events: unknown[] = [];

  beforeEach(async () => {
    ds = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: ENTITIES,
      synchronize: true,
    }).initialize();
    process.env.LPR_SNAP_DIR = mkdtempSync(join(tmpdir(), 'lpr-spec-'));
    bus = new ControlBus();
    bus.subscribe((e) => events.push(e));
    const audit = { record: jest.fn().mockResolvedValue({}) } as unknown as AuditService;
    service = new LprService(
      ds.getRepository(LprDevice),
      ds.getRepository(LprPassRecord),
      ds.getRepository(LprWhitelist),
      ds.getRepository(LprGateEvent),
      ds.getRepository(LprPlatformConfig),
      bus,
      audit,
    );
    events.length = 0;
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('心跳自动登记设备并标记在线', async () => {
    await service.heartbeat('SN001', { ip: '127.0.0.1', deviceName: '东门相机' });
    const devs = await service.listDevices();
    expect(devs).toHaveLength(1);
    expect(devs[0].online).toBe(true);
    expect(devs[0].deviceName).toBe('东门相机');
  });

  it('按序列号预登记: 上线前离线, 字段与 IO/方向归一正确', async () => {
    const v = await service.createDevice({
      serialno: 'PRE-1', deviceName: '北门入口相机', location: '北门', model: 'C5H',
      ip: '192.168.180.101', passDirection: 'in', gateIo: 9,
    });
    expect(v.online).toBe(false);
    expect(v.lastHeartbeat).toBeNull();
    expect(v.gateIo).toBe(0); // 越界 9 归一到 0
    expect(v.passDirection).toBe('in');
    expect(v.location).toBe('北门');
    const v2 = await service.createDevice({
      serialno: 'PRE-2', deviceName: '出口相机', passDirection: 'bad' as never, gateIo: 2,
    });
    expect(v2.passDirection).toBeNull(); // 非法方向归一为 null
    expect(v2.gateIo).toBe(2);
  });

  it('预登记幂等: 序列号已存在(含已自动登记)则更新不重复', async () => {
    await service.heartbeat('SN001', { ip: '127.0.0.1', deviceName: '东门相机' });
    const v = await service.createDevice({
      serialno: 'SN001', deviceName: '北门入口相机', location: '北门', model: 'C5H',
      passDirection: 'in', gateIo: 0,
    });
    expect(v.deviceName).toBe('北门入口相机');
    expect(v.passDirection).toBe('in');
    const devs = await service.listDevices();
    expect(devs).toHaveLength(1); // 不新增重复设备
  });

  it('预登记缺序列号抛错', async () => {
    await expect(service.createDevice({ serialno: '   ' } as never)).rejects.toThrow();
  });

  it('web 后台地址按型号推导: XLT 走 /pc/#/login, 其余走根路径; 显式 webUrl 优先', async () => {
    const xlt = await service.createDevice({
      serialno: 'XLT-1', model: 'XLT', ip: '192.168.180.111',
    });
    expect(xlt.webUrl).toBe('http://192.168.180.111/pc/#/login');
    const c5h = await service.createDevice({
      serialno: 'C5H-1', model: 'C5H', ip: '192.168.180.101',
    });
    expect(c5h.webUrl).toBe('http://192.168.180.101');
    const noIp = await service.createDevice({ serialno: 'NOIP-1', model: 'C5H' });
    expect(noIp.webUrl).toBeNull();
    const override = await service.createDevice({
      serialno: 'OV-1', model: 'XLT', ip: '192.168.180.200', webUrl: 'http://192.168.180.200/custom',
    });
    expect(override.webUrl).toBe('http://192.168.180.200/custom');
  });

  it('公开设备列表不含 web 口令; 管理员列表含账号/口令, 默认 admin/admin', async () => {
    await service.createDevice({ serialno: 'CRED-1', model: 'XLT', ip: '192.168.180.111' });
    const pub = await service.listDevices();
    expect(pub[0]).not.toHaveProperty('webPassword');
    expect(pub[0]).not.toHaveProperty('webUser');
    expect(pub[0].webUrl).toBe('http://192.168.180.111/pc/#/login');
    const admin = await service.listDevicesAdmin();
    expect(admin[0].webUser).toBe('admin');
    expect(admin[0].webPassword).toBe('admin');
    // 可自定义口令
    await service.updateDevice(admin[0].id, { webUser: 'root', webPassword: 'Secret#1' });
    const admin2 = await service.listDevicesAdmin();
    expect(admin2[0].webUser).toBe('root');
    expect(admin2[0].webPassword).toBe('Secret#1');
  });

  it('平台接入配置: 首读默认 erp.cnjinhu.com, 更新归一化, 且声明不支持远程改相机', async () => {
    const def = await service.getPlatformConfig();
    expect(def.host).toBe('erp.cnjinhu.com');
    expect(def.httpPort).toBe(80);
    expect(def.httpsPort).toBe(443);
    expect(def.cometPath).toBe('/api/lpr/comet');
    expect(def.remoteChangeSupported).toBe(false);
    const upd = await service.updatePlatformConfig({
      host: 'park.example.com',
      httpPort: 8080,
      cometPath: 'api/lpr/comet', // 缺前导斜杠 -> 自动补
    });
    expect(upd.host).toBe('park.example.com');
    expect(upd.httpPort).toBe(8080);
    expect(upd.cometPath).toBe('/api/lpr/comet');
    expect(upd.httpsPort).toBe(443); // 未提供的保持
    // 非法端口回退
    const bad = await service.updatePlatformConfig({ httpsPort: 999999 });
    expect(bad.httpsPort).toBe(443);
  });

  it('命中白名单 -> 回复 info:ok 自动开闸, 落库 auto 并发 WS', async () => {
    await service.heartbeat('SN001', {});
    await service.updateDevice((await service.listDevices())[0].id, { gateIo: 2, passDirection: 'in' });
    await service.upsertWhitelist({ plate: '鲁Q12345', groupName: 'staff' });

    const reply = await service.handlePlate(plateBody());
    expect(reply.Response_AlarmInfoPlate).toMatchObject({ info: 'ok', channelNum: 2 });

    const recent = await service.recent();
    expect(recent).toHaveLength(1);
    expect(recent[0].releaseResult).toBe('auto');
    expect(recent[0].passDirection).toBe('in');
    expect(events.some((e) => (e as { type: string }).type === 'lpr_pass')).toBe(true);

    const stats = await service.stats();
    expect(stats.todayIn).toBe(1);
    expect(stats.onsite).toBe(1);
    expect(stats.autoReleased).toBe(1);
  });

  it('黑名单 -> 不开闸, release=deny 并计入异常', async () => {
    await service.heartbeat('SN001', {});
    await service.upsertWhitelist({ plate: '鲁Q12345', groupName: 'black', isBlack: true });
    const reply = await service.handlePlate(plateBody());
    expect((reply.Response_AlarmInfoPlate as Record<string, unknown>).info).toBeUndefined();
    const recent = await service.recent();
    expect(recent[0].releaseResult).toBe('deny');
    expect((await service.stats()).abnormal).toBe(1);
  });

  it('非白名单 -> 空回复, 不自动放行', async () => {
    await service.heartbeat('SN001', {});
    const reply = await service.handlePlate(plateBody());
    expect(reply.Response_AlarmInfoPlate).toEqual({});
    expect((await service.recent())[0].releaseResult).toBe('none');
  });

  it('plateid 幂等: 重传不重复落库、不重复抬杆', async () => {
    await service.heartbeat('SN001', {});
    await service.upsertWhitelist({ plate: '鲁Q12345', groupName: 'staff' });
    const first = await service.handlePlate(plateBody());
    const second = await service.handlePlate(plateBody());
    expect((first.Response_AlarmInfoPlate as { info?: string }).info).toBe('ok');
    expect((second.Response_AlarmInfoPlate as { info?: string }).info).toBeUndefined();
    expect(await ds.getRepository(LprPassRecord).count()).toBe(1);
  });

  it('离线补传 isoffline=1 不开闸, 回复 ContinuePushOffline', async () => {
    await service.heartbeat('SN001', {});
    await service.upsertWhitelist({ plate: '鲁Q12345', groupName: 'staff' });
    const reply = await service.handlePlate(plateBody({ plateid: 'p-off', isoffline: 1 }));
    const inner = reply.Response_AlarmInfoPlate as Record<string, unknown>;
    expect(inner.info).toBeUndefined();
    expect(inner.ContinuePushOffline).toMatchObject({ continue: 1 });
  });

  it('comet: 无连接时手动开闸排队, 下次轮询立即取走', async () => {
    await service.heartbeat('SNCOMET', {});
    const opened = await service.openGate({ serialno: 'SNCOMET' }, 'tester');
    expect(opened.delivered).toBe(false);
    expect(opened.queued).toBe(true);
    const reply = await service.cometPoll('SNCOMET');
    expect((reply.Response_AlarmInfoPlate as { info?: string }).info).toBe('ok');
  });

  it('comet: 短轮询下手动开闸一律入队, 下一轮立即取走(不因子连接早断丢失)', async () => {
    await service.heartbeat('SNCOMET2', {});
    // 即使相机此刻有一轮"在途"轮询, 开闸也只入队不绑定连接
    const inFlight = service.cometPoll('SNCOMET2');
    expect((await inFlight).Response_AlarmInfoPlate).toEqual({});
    const opened = await service.openGate({ serialno: 'SNCOMET2' }, 'tester');
    expect(opened.delivered).toBe(false);
    expect(opened.queued).toBe(true);
    const reply = await service.cometPoll('SNCOMET2');
    expect((reply.Response_AlarmInfoPlate as { info?: string }).info).toBe('ok');
  });

  it('comet: 新增白名单在下一轮短轮询立即同步', async () => {
    await service.heartbeat('SNWL', {});
    // 无命令的空轮询立即回空(不挂起)
    const empty = await service.cometPoll('SNWL');
    expect(empty.Response_AlarmInfoPlate).toEqual({});
    await service.upsertWhitelist({ plate: '鲁QWake1', groupName: 'staff' });
    // 相机下一轮 (~1s) 立即取走 pending 白名单
    const next = await service.cometPoll('SNWL');
    expect(next.Response_AlarmInfoPlate).toHaveProperty('white_list_operate');
  });

  it('道闸状态通知落库并发布事件', async () => {
    await service.handleGateStatus({ cmd: 'barr_gate_status_notify', serialno: 'SN001', gate_status: 1 });
    const devs = await service.listDevices();
    expect(devs[0].gateStatus).toBe(1);
    expect(devs[0].gateStatusLabel).toBe('开到位');
    expect(events.some((e) => (e as { type: string }).type === 'lpr_gate_status')).toBe(true);
  });

  it('抓拍小图落盘并可回读', async () => {
    await service.heartbeat('SN001', {});
    const b64 = Buffer.from('JPEG-BYTES').toString('base64');
    await service.handlePlate(plateBody({ plateid: 'p-pic', imageFragmentFile: b64 }));
    const rec = (await service.recent())[0];
    expect(rec.picSmallUrl).toContain('/small');
    const buf = await service.readSnap(rec.id, 'small');
    expect(buf.toString()).toBe('JPEG-BYTES');
    const dir = process.env.LPR_SNAP_DIR as string;
    expect(existsSync(dir)).toBe(true);
    void readFileSync;
  });
});
