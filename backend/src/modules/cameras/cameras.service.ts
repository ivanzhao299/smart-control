import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as https from 'https';
import * as http from 'http';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

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
    rtspPort: 554,
    username: 'admin',
    password: 'jh666888',
  },
  {
    id: 'nvr-port5',
    name: '消防控制室Port5录像机',
    ip: '192.168.1.5',
    port: 80,
    rtspPort: 554,
    username: 'admin',
    password: 'jh666888',
  },
];

/**
 * 摄像头通道映射
 * channel参数 -> NVR + 海康通道号(格式: XXXX, 如3701=通道37主码流)
 */
const CHANNEL_MAP: Record<string, { nvrId: string; hikChannel: string; name: string }> = {
  // Port5录像机 (192.168.1.5)
  'd37': { nvrId: 'nvr-port5', hikChannel: '3701', name: '大门' },
  '37': { nvrId: 'nvr-port5', hikChannel: '3701', name: '大门' },
  'p5-d37': { nvrId: 'nvr-port5', hikChannel: '3701', name: '大门' },
  'd01': { nvrId: 'nvr-port5', hikChannel: '101', name: '通道1' },
  '1': { nvrId: 'nvr-port5', hikChannel: '101', name: '通道1' },
  'p5-d01': { nvrId: 'nvr-port5', hikChannel: '101', name: '通道1' },
  'd02': { nvrId: 'nvr-port5', hikChannel: '201', name: '通道2' },
  '2': { nvrId: 'nvr-port5', hikChannel: '201', name: '通道2' },
  'p5-d02': { nvrId: 'nvr-port5', hikChannel: '201', name: '通道2' },
  'd10': { nvrId: 'nvr-port5', hikChannel: '1001', name: '通道10' },
  '10': { nvrId: 'nvr-port5', hikChannel: '1001', name: '通道10' },
  'p5-d10': { nvrId: 'nvr-port5', hikChannel: '1001', name: '通道10' },
  // Port3录像机 (192.168.1.19)
  'p3-d37': { nvrId: 'nvr-port3', hikChannel: '3701', name: 'Port3通道37' },
  'p3-d45': { nvrId: 'nvr-port3', hikChannel: '4501', name: 'Port3通道45' },
  'p3-d50': { nvrId: 'nvr-port3', hikChannel: '5001', name: 'Port3通道50' },
};

/**
 * HLS转码会话状态
 */
interface HlsSession {
  channel: string;
  process: ChildProcess;
  outputDir: string;
  playlistPath: string;
  startedAt: number;
  restartCount: number;
  isRunning: boolean;
}

@Injectable()
export class CamerasService implements OnModuleDestroy {
  private readonly logger = new Logger(CamerasService.name);
  private hlsSessions = new Map<string, HlsSession>();
  private readonly hlsRootDir: string;
  private readonly ffmpegPath: string;

  constructor() {
    // HLS输出目录：项目根目录/tmp/hls
    this.hlsRootDir = path.resolve(process.cwd(), '..', 'tmp', 'hls');
    if (!fs.existsSync(this.hlsRootDir)) {
      fs.mkdirSync(this.hlsRootDir, { recursive: true });
    }

    // FFmpeg路径：优先使用环境变量，否则使用系统PATH
    this.ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
    this.logger.log(`HLS转码服务初始化，输出目录: ${this.hlsRootDir}, FFmpeg: ${this.ffmpegPath}`);
  }

  /**
   * 模块销毁时停止所有转码会话
   */
  onModuleDestroy() {
    this.logger.log('模块销毁，停止所有HLS转码会话');
    for (const channel of this.hlsSessions.keys()) {
      this.stopHlsStream(channel);
    }
  }

  /**
   * 获取指定通道的快照
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
   * 启动HLS转码流
   * @param channel 通道标识
   * @returns HLS播放列表路径
   */
  async startHlsStream(channel: string): Promise<{ playlistUrl: string; outputDir: string }> {
    const channelKey = channel.toLowerCase();

    // 如果已经在运行，直接返回
    const existing = this.hlsSessions.get(channelKey);
    if (existing && existing.isRunning) {
      this.logger.log(`通道 ${channelKey} HLS转码已在运行`);
      return {
        playlistUrl: `/api/cameras/${channelKey}/hls/playlist.m3u8`,
        outputDir: existing.outputDir,
      };
    }

    const mapping = CHANNEL_MAP[channelKey];
    if (!mapping) {
      throw new Error(`未知通道: ${channel}`);
    }

    const nvr = NVR_CONFIGS.find((n) => n.id === mapping.nvrId);
    if (!nvr) {
      throw new Error(`NVR配置不存在: ${mapping.nvrId}`);
    }

    // 构造RTSP地址
    const rtspUrl = `rtsp://${nvr.username}:${encodeURIComponent(nvr.password)}@${nvr.ip}:${nvr.rtspPort}/Streaming/Channels/${mapping.hikChannel}`;

    // 输出目录
    const outputDir = path.join(this.hlsRootDir, channelKey);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const playlistPath = path.join(outputDir, 'playlist.m3u8');
    const segmentPattern = path.join(outputDir, 'segment_%03d.ts');

    this.logger.log(`启动HLS转码: ${channelKey} (${mapping.name}) -> ${outputDir}`);
    this.logger.log(`RTSP源: rtsp://${nvr.username}:****@${nvr.ip}:${nvr.rtspPort}/Streaming/Channels/${mapping.hikChannel}`);

    // FFmpeg参数
    const ffmpegArgs = [
      '-rtsp_transport', 'tcp',
      '-i', rtspUrl,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-f', 'hls',
      '-hls_time', '2',
      '-hls_list_size', '6',
      '-hls_flags', 'delete_segments+append_list',
      '-hls_segment_filename', segmentPattern,
      '-y',
      playlistPath,
    ];

    // 启动FFmpeg进程
    const process = spawn(this.ffmpegPath, ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const session: HlsSession = {
      channel: channelKey,
      process,
      outputDir,
      playlistPath,
      startedAt: Date.now(),
      restartCount: 0,
      isRunning: true,
    };

    this.hlsSessions.set(channelKey, session);

    // 处理FFmpeg输出
    process.stderr?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg && (msg.includes('error') || msg.includes('Error'))) {
        this.logger.warn(`[FFmpeg ${channelKey}] ${msg.substring(0, 200)}`);
      }
    });

    process.stdout?.on('data', () => {
      // 忽略stdout输出
    });

    process.on('close', (code) => {
      session.isRunning = false;
      this.logger.log(`[FFmpeg ${channelKey}] 进程退出，代码: ${code}`);

      // 自动重启（最多重启5次）
      if (session.restartCount < 5) {
        session.restartCount++;
        this.logger.log(`[FFmpeg ${channelKey}] 自动重启 (第${session.restartCount}次)...`);
        setTimeout(() => {
          if (this.hlsSessions.has(channelKey)) {
            this.restartHlsStream(channelKey);
          }
        }, 3000);
      } else {
        this.logger.error(`[FFmpeg ${channelKey}] 重启次数超限，停止自动重启`);
      }
    });

    process.on('error', (err) => {
      this.logger.error(`[FFmpeg ${channelKey}] 进程错误: ${err.message}`);
      session.isRunning = false;
    });

    // 等待播放列表文件生成
    await this.waitForFile(playlistPath, 15000);

    return {
      playlistUrl: `/api/cameras/${channelKey}/hls/playlist.m3u8`,
      outputDir,
    };
  }

  /**
   * 停止HLS转码流
   */
  stopHlsStream(channel: string): void {
    const channelKey = channel.toLowerCase();
    const session = this.hlsSessions.get(channelKey);

    if (session) {
      this.logger.log(`停止HLS转码: ${channelKey}`);
      session.isRunning = false;
      session.process.kill('SIGTERM');

      // 清理输出目录
      try {
        if (fs.existsSync(session.outputDir)) {
          fs.rmSync(session.outputDir, { recursive: true, force: true });
        }
      } catch (e) {
        this.logger.warn(`清理HLS输出目录失败: ${(e as Error).message}`);
      }

      this.hlsSessions.delete(channelKey);
    }
  }

  /**
   * 重启HLS转码流
   */
  private restartHlsStream(channel: string): void {
    const channelKey = channel.toLowerCase();
    const session = this.hlsSessions.get(channelKey);
    if (!session) return;

    const mapping = CHANNEL_MAP[channelKey];
    const nvr = NVR_CONFIGS.find((n) => n.id === mapping.nvrId);
    if (!mapping || !nvr) return;

    const rtspUrl = `rtsp://${nvr.username}:${encodeURIComponent(nvr.password)}@${nvr.ip}:${nvr.rtspPort}/Streaming/Channels/${mapping.hikChannel}`;
    const segmentPattern = path.join(session.outputDir, 'segment_%03d.ts');

    const ffmpegArgs = [
      '-rtsp_transport', 'tcp',
      '-i', rtspUrl,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-f', 'hls',
      '-hls_time', '2',
      '-hls_list_size', '6',
      '-hls_flags', 'delete_segments+append_list',
      '-hls_segment_filename', segmentPattern,
      '-y',
      session.playlistPath,
    ];

    const process = spawn(this.ffmpegPath, ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    session.process = process;
    session.isRunning = true;
    session.startedAt = Date.now();

    process.stderr?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg && (msg.includes('error') || msg.includes('Error'))) {
        this.logger.warn(`[FFmpeg ${channelKey}] ${msg.substring(0, 200)}`);
      }
    });

    process.on('close', (code) => {
      session.isRunning = false;
      this.logger.log(`[FFmpeg ${channelKey}] 进程退出，代码: ${code}`);
      if (session.restartCount < 5) {
        session.restartCount++;
        setTimeout(() => {
          if (this.hlsSessions.has(channelKey)) {
            this.restartHlsStream(channelKey);
          }
        }, 3000);
      }
    });
  }

  /**
   * 获取HLS文件内容
   */
  getHlsFile(channel: string, filename: string): { buffer: Buffer; contentType: string } | null {
    const channelKey = channel.toLowerCase();
    const session = this.hlsSessions.get(channelKey);

    if (!session) {
      return null;
    }

    const filePath = path.join(session.outputDir, filename);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filename).toLowerCase();
    const contentType = ext === '.m3u8' ? 'application/vnd.apple.mpegurl' : 'video/mp2t';

    return { buffer, contentType };
  }

  /**
   * 获取HLS转码状态
   */
  getHlsStatus(channel: string): { isRunning: boolean; restartCount: number; uptime: number } | null {
    const channelKey = channel.toLowerCase();
    const session = this.hlsSessions.get(channelKey);

    if (!session) {
      return null;
    }

    return {
      isRunning: session.isRunning,
      restartCount: session.restartCount,
      uptime: Date.now() - session.startedAt,
    };
  }

  /**
   * 获取所有HLS会话状态
   */
  getAllHlsSessions() {
    const sessions: Array<{
      channel: string;
      isRunning: boolean;
      restartCount: number;
      uptime: number;
      outputDir: string;
    }> = [];

    for (const [channel, session] of this.hlsSessions.entries()) {
      sessions.push({
        channel,
        isRunning: session.isRunning,
        restartCount: session.restartCount,
        uptime: Date.now() - session.startedAt,
        outputDir: session.outputDir,
      });
    }

    return sessions;
  }

  /**
   * 等待文件生成
   */
  private waitForFile(filePath: string, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        if (fs.existsSync(filePath)) {
          clearInterval(checkInterval);
          resolve();
        } else if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          reject(new Error(`等待文件超时: ${filePath}`));
        }
      }, 500);
    });
  }

  /**
   * 带Digest认证的HTTP GET请求
   */
  private async httpGetWithDigestAuth(
    url: string,
    username: string,
    password: string,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);

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

            const authParams = this.parseDigestAuth(wwwAuth as string);
            const ha1 = this.md5(`${username}:${authParams.realm}:${password}`);
            const ha2 = this.md5(`GET:${parsedUrl.pathname}`);
            const nonceCount = '00000001';
            const cnonce = this.generateCnonce();
            const response = this.md5(`${ha1}:${authParams.nonce}:${nonceCount}:${cnonce}:auth:${ha2}`);

            const authHeader = `Digest username="${username}", realm="${authParams.realm}", nonce="${authParams.nonce}", uri="${parsedUrl.pathname}", qop=auth, nc=${nonceCount}, cnonce="${cnonce}", response="${response}", opaque="${authParams.opaque || ''}"`;

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

  private md5(str: string): string {
    return require('crypto').createHash('md5').update(str).digest('hex');
  }

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
