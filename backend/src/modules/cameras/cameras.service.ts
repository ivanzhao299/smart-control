import { Injectable, Logger } from '@nestjs/common';
import * as https from 'https';
import * as http from 'http';

/**
 * 海康威视NVR配置
 * 两台NVR都已迁移到1网段(VLAN101)
 */
const NVR_CONFIGS = [
  {
    id: 'nvr-port3',
    name: '消防控制室Port3录像机',
    ip: '192.168.1.19',
    port: 80,
    username: 'admin',
    password: 'jh666888',
  },
  {
    id: 'nvr-port5',
    name: '消防控制室Port5录像机',
    ip: '192.168.1.5',
    port: 80,
    username: 'admin',
    password: 'jh666888',
  },
];

/**
 * 摄像头通道映射
 * channel参数 -> NVR + 海康通道号(格式: XXXX, 如3701=通道37主码流)
 */
const CHANNEL_MAP: Record<string, { nvrId: string; hikChannel: string; name: string }> = {
  'd37': { nvrId: 'nvr-port5', hikChannel: '3701', name: '大门' },
  '37': { nvrId: 'nvr-port5', hikChannel: '3701', name: '大门' },
};

@Injectable()
export class CamerasService {
  private readonly logger = new Logger(CamerasService.name);

  /**
   * 获取指定通道的快照
   * @param channel 通道标识 (如 d37, 37)
   * @returns 图片Buffer和Content-Type
   */
  async getSnapshot(channel: string): Promise<{ buffer: Buffer; contentType: string }> {
    const channelKey = channel.toLowerCase();
    const mapping = CHANNEL_MAP[channelKey];

    if (!mapping) {
      throw new Error(`未知通道: ${channel}，支持的通道: ${Object.keys(CHANNEL_MAP).join(', ')}`);
    }

    const nvr = NVR_CONFIGS.find((n) => n.id === mapping.nvrId);
    if (!nvr) {
      throw new Error(`NVR配置不存在: ${mapping.nvrId}`);
    }

    const url = `http://${nvr.ip}:${nvr.port}/ISAPI/Streaming/channels/${mapping.hikChannel}/picture`;
    this.logger.log(`获取快照: ${url} (通道: ${channel} -> ${mapping.name})`);

    try {
      const buffer = await this.httpGetWithDigestAuth(url, nvr.username, nvr.password);
      return { buffer, contentType: 'image/jpeg' };
    } catch (error) {
      this.logger.error(`获取快照失败: ${(error as Error).message}`);
      throw new Error(`获取摄像头快照失败: ${(error as Error).message}`);
    }
  }

  /**
   * 带Digest认证的HTTP GET请求
   * 海康威视ISAPI接口使用Digest认证
   */
  private async httpGetWithDigestAuth(
    url: string,
    username: string,
    password: string,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);

      // 第一次请求，获取WWW-Authenticate头
      const firstReq = http.get(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port,
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'GET',
        },
        (firstRes) => {
          if (firstRes.statusCode === 401) {
            const wwwAuth = firstRes.headers['www-authenticate'];
            if (!wwwAuth) {
              reject(new Error('未找到WWW-Authenticate头'));
              return;
            }

            // 解析Digest认证参数
            const authParams = this.parseDigestAuth(wwwAuth as string);
            const ha1 = this.md5(`${username}:${authParams.realm}:${password}`);
            const ha2 = this.md5(`GET:${parsedUrl.pathname}`);
            const nonceCount = '00000001';
            const cnonce = this.generateCnonce();
            const response = this.md5(`${ha1}:${authParams.nonce}:${nonceCount}:${cnonce}:auth:${ha2}`);

            const authHeader = `Digest username="${username}", realm="${authParams.realm}", nonce="${authParams.nonce}", uri="${parsedUrl.pathname}", qop=auth, nc=${nonceCount}, cnonce="${cnonce}", response="${response}", opaque="${authParams.opaque || ''}"`;

            // 第二次请求，带认证头
            const secondReq = http.get(
              {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port,
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'GET',
                headers: { Authorization: authHeader },
              },
              (secondRes) => {
                if (secondRes.statusCode === 200) {
                  const chunks: Buffer[] = [];
                  secondRes.on('data', (chunk) => chunks.push(chunk));
                  secondRes.on('end', () => resolve(Buffer.concat(chunks)));
                  secondRes.on('error', reject);
                } else {
                  reject(new Error(`认证后请求失败: HTTP ${secondRes.statusCode}`));
                }
              },
            );
            secondReq.on('error', reject);
            secondReq.setTimeout(10000, () => {
              secondReq.destroy();
              reject(new Error('请求超时'));
            });
          } else if (firstRes.statusCode === 200) {
            // 不需要认证
            const chunks: Buffer[] = [];
            firstRes.on('data', (chunk) => chunks.push(chunk));
            firstRes.on('end', () => resolve(Buffer.concat(chunks)));
            firstRes.on('error', reject);
          } else {
            reject(new Error(`请求失败: HTTP ${firstRes.statusCode}`));
          }
        },
      );

      firstReq.on('error', reject);
      firstReq.setTimeout(10000, () => {
        firstReq.destroy();
        reject(new Error('请求超时'));
      });
    });
  }

  /**
   * 解析Digest认证参数
   */
  private parseDigestAuth(header: string): Record<string, string> {
    const params: Record<string, string> = {};
    const parts = header.replace(/^Digest\s+/i, '').split(',');
    for (const part of parts) {
      const match = part.trim().match(/^(\w+)="?([^"]*)"?$/);
      if (match) {
        params[match[1]] = match[2];
      }
    }
    return params;
  }

  /**
   * 简单MD5实现（Node.js crypto）
   */
  private md5(str: string): string {
    return require('crypto').createHash('md5').update(str).digest('hex');
  }

  /**
   * 生成随机cnonce
   */
  private generateCnonce(): string {
    return Math.random().toString(36).substring(2, 10);
  }

  /**
   * 获取支持的通道列表
   */
  getSupportedChannels() {
    return Object.entries(CHANNEL_MAP).map(([key, value]) => ({
      channel: key,
      name: value.name,
      nvr: NVR_CONFIGS.find((n) => n.id === value.nvrId)?.name,
      hikChannel: value.hikChannel,
    }));
  }
}
