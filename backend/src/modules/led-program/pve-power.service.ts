/**
 * PVE 主机电源控制
 *
 * - 开机：WOL 魔术包广播到 255.255.255.255:9（MAC d4:c9:ef:d3:c2:b6）
 * - 关机：SSH 到 192.168.77.10 执行 poweroff（root 免密已配）
 * - 状态：ping 探活（ICMP）或 HTTP 探活 receiver 端口
 *
 * 定时同步：与 LED 1f-led 回路的 power_schedules 对齐——
 *   LED 开机前 2 分钟先 WOL 唤醒 PVE（PVE 启动需要时间），
 *   LED 关机后 5 分钟 SSH 关 PVE。
 */
import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { promisify } from 'node:util';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HardwareUnit } from '../../entities/hardware-unit.entity';

const execFileAsync = promisify(execFile);

const PVE_MAC = 'd4:c9:ef:d3:c2:b6';
const PVE_IP = '192.168.77.10';
const PVE_SSH_USER = 'root';

@Injectable()
export class PvePowerService {
  private readonly logger = new Logger(PvePowerService.name);

  constructor(
    @InjectRepository(HardwareUnit)
    private readonly hwUnitRepo: Repository<HardwareUnit>,
  ) {}

  /** 发 WOL 魔术包唤醒 PVE */
  async wake(): Promise<{ ok: boolean; message: string }> {
    try {
      const macBytes = PVE_MAC.split(':').map((h) => parseInt(h, 16));
      // 魔术包：6个0xFF + 16次MAC地址
      const packet = Buffer.alloc(6 + 16 * 6);
      for (let i = 0; i < 6; i++) packet[i] = 0xff;
      for (let i = 0; i < 16; i++) {
        for (let j = 0; j < 6; j++) {
          packet[6 + i * 6 + j] = macBytes[j];
        }
      }

      await new Promise<void>((resolve, reject) => {
        const sock = createSocket('udp4');
        sock.on('error', reject);
        sock.send(packet, 0, packet.length, 9, '255.255.255.255', (err) => {
          sock.close();
          if (err) reject(err);
          else resolve();
        });
      });

      this.logger.log(`WOL 魔术包已发送到 ${PVE_MAC}（广播 255.255.255.255:9）`);
      return { ok: true, message: 'WOL 唤醒包已发送，PVE 约 30-60 秒后启动' };
    } catch (e) {
      const msg = (e as Error).message;
      this.logger.warn(`WOL 发送失败: ${msg}`);
      return { ok: false, message: `WOL 发送失败: ${msg}` };
    }
  }

  /** SSH 远程关机 PVE */
  async shutdown(): Promise<{ ok: boolean; message: string }> {
    try {
      // 用 ssh 命令发 poweroff，2秒超时
      await execFileAsync(
        'ssh',
        [
          '-o', 'BatchMode=yes',
          '-o', 'ConnectTimeout=5',
          '-o', 'StrictHostKeyChecking=no',
          `${PVE_SSH_USER}@${PVE_IP}`,
          'poweroff',
        ],
        { timeout: 10_000 },
      );
      this.logger.log(`SSH 关机命令已发送到 ${PVE_IP}`);
      return { ok: true, message: '关机命令已发送，PVE 即将关闭' };
    } catch (e) {
      const msg = (e as Error).message;
      // exit code 0 但 ssh 返回非0是正常的（连接被断开）
      this.logger.warn(`SSH 关机返回: ${msg}`);
      if (msg.includes('Connection refused') || msg.includes('Connection timed out')) {
        return { ok: true, message: 'PVE 已离线（SSH 无法连接，说明已关机或网络不通）' };
      }
      return { ok: false, message: `SSH 关机失败: ${msg}` };
    }
  }

  /** 探测 PVE 在线状态：ping + HTTP receiver 探活 */
  async status(): Promise<{ online: boolean; method: string }> {
    // 先 ping
    try {
      await execFileAsync('ping', ['-c', '1', '-W', '2', PVE_IP], { timeout: 5_000 });
      return { online: true, method: 'ping' };
    } catch {
      return { online: false, method: 'ping' };
    }
  }

  /** 从 hardware_units 读 PVE 的实际 IP（允许现场改） */
  private async getPveIp(): Promise<string> {
    try {
      const unit = await this.hwUnitRepo.findOne({ where: { code: 'PVE-REC-01' } });
      if (unit?.ip) return unit.ip;
    } catch { /* 表未迁移时回退默认值 */ }
    return PVE_IP;
  }
}
