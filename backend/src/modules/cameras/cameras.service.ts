import { Injectable, Logger, OnModuleDestroy, OnApplicationBootstrap } from '@nestjs/common';
import * as https from 'https';
import * as http from 'http';
import { spawn, spawnSync, ChildProcess } from 'child_process';
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
    ip: process.env.NVR_PORT3_IP || '192.168.1.19',
    port: 80,
    rtspPort: parseInt(process.env.NVR_PORT3_RTSP_PORT || '554', 10),
    username: 'admin',
    password: 'Jh666888',
  },
  {
    id: 'nvr-port5',
    name: '消防控制室Port5录像机',
    ip: process.env.NVR_PORT5_IP || '192.168.1.5',
    port: 80,
    rtspPort: parseInt(process.env.NVR_PORT5_RTSP_PORT || '554', 10),
    username: 'admin',
    password: 'jh666888',
  },
];

/**
 * 摄像头通道映射
 * channel参数 -> NVR + 海康通道号(格式: XXXX, 如3701=通道37主码流)
 */
const CHANNEL_MAP: Record<string, { nvrId: string; hikChannel: string; name: string }> = {
  // Port5录像机 (192.168.1.5) — 使用子码流(XX02)降低码率和CPU负载
  'd37': { nvrId: 'nvr-port5', hikChannel: '3702', name: '大门' },
  '37': { nvrId: 'nvr-port5', hikChannel: '3702', name: '大门' },
  'p5-d37': { nvrId: 'nvr-port5', hikChannel: '3702', name: '大门' },
  'd01': { nvrId: 'nvr-port5', hikChannel: '102', name: '通道1' },
  '1': { nvrId: 'nvr-port5', hikChannel: '102', name: '通道1' },
  'p5-d01': { nvrId: 'nvr-port5', hikChannel: '102', name: '通道1' },
  'd02': { nvrId: 'nvr-port5', hikChannel: '202', name: '通道2' },
  '2': { nvrId: 'nvr-port5', hikChannel: '202', name: '通道2' },
  'p5-d02': { nvrId: 'nvr-port5', hikChannel: '202', name: '通道2' },
  'd10': { nvrId: 'nvr-port5', hikChannel: '1002', name: '通道10' },
  '10': { nvrId: 'nvr-port5', hikChannel: '1002', name: '通道10' },
  'p5-d10': { nvrId: 'nvr-port5', hikChannel: '1002', name: '通道10' },
  'd57': { nvrId: 'nvr-port5', hikChannel: '5702', name: '通道57' },
  '57': { nvrId: 'nvr-port5', hikChannel: '5702', name: '通道57' },
  'p5-d57': { nvrId: 'nvr-port5', hikChannel: '5702', name: '通道57' },
  // Port3录像机 (192.168.1.19)
  'p3-d37': { nvrId: 'nvr-port3', hikChannel: '3702', name: 'Port3通道37' },
  // D45/D50在Port5录像机上（Port3上这两个通道返回503不存在）
  'p3-d45': { nvrId: 'nvr-port5', hikChannel: '4502', name: 'Port5通道45' },
  'p3-d50': { nvrId: 'nvr-port5', hikChannel: '5002', name: 'Port5通道50' },
  'p5-d45': { nvrId: 'nvr-port5', hikChannel: '4502', name: 'Port5通道45' },
  'p5-d50': { nvrId: 'nvr-port5', hikChannel: '5002', name: 'Port5通道50' },
};

/**
 * 后端启动后默认自动拉起的 HLS 直播通道（运营大屏实际使用的 6 路，
 * 与 D:\smart-control\tmp\hls 下的子目录名一一对应）。
 * 可用环境变量 HLS_AUTOSTART_CHANNELS 覆盖（逗号分隔）。
 */
const DEFAULT_AUTOSTART_CHANNELS = ['d02', 'd37', 'd57', 'p3-d37', 'p3-d45', 'p3-d50'];

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
  // 代际：每次(重)启动 +1。旧进程的 close 回调只有在“仍是当前代际”时才允许自动重启，
  // 被 restart 替换掉的旧进程退出时直接忽略，杜绝“旧进程 close 又 spawn 一个”的越重启越多。
  generation: number;
  // 是否被主动停止：stop 后置 true，其 close 不再自动拉起。
  stopped: boolean;
  // 分片停滞连续命中次数：连续 2 次才判死重启，避免一次网络抖动就 kill+spawn 制造孤儿。
  stallCount: number;
}

@Injectable()
export class CamerasService implements OnModuleDestroy, OnApplicationBootstrap {
  private readonly logger = new Logger(CamerasService.name);
  private hlsSessions = new Map<string, HlsSession>();
  private readonly hlsRootDir: string;
  private readonly ffmpegPath: string;
  private healthCheckInterval: NodeJS.Timeout;

  constructor() {
    // HLS输出目录：项目根目录/tmp/hls
    this.hlsRootDir = path.resolve(process.cwd(), '..', 'tmp', 'hls');
    if (!fs.existsSync(this.hlsRootDir)) {
      fs.mkdirSync(this.hlsRootDir, { recursive: true });
    }

    // FFmpeg路径：优先使用环境变量，否则使用系统PATH
    this.ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
    this.logger.log(`HLS转码服务初始化，输出目录: ${this.hlsRootDir}, FFmpeg: ${this.ffmpegPath}`);

    // 健康检查：每30秒检查所有HLS会话状态，异常自动重启
    this.healthCheckInterval = setInterval(() => {
      this.checkHlsHealth();
    }, 30000);
    this.logger.log('HLS健康检查守护已启动，每30秒检查一次');
  }

  /**
   * 健康检查：监控FFmpeg进程状态和HLS分片更新，异常自动重启
   */
  private checkHlsHealth(): void {
    for (const [channelKey, session] of this.hlsSessions.entries()) {
      try {
        // 检查1：进程是否还在运行
        if (session.isRunning && session.process && session.process.killed) {
          this.logger.warn(`[健康检查] ${channelKey} 进程已退出但标记为运行中，触发重启`);
          session.isRunning = false;
          if (session.restartCount < 10) {
            session.restartCount++;
            setTimeout(() => this.restartHlsStream(channelKey), 2000);
          }
          continue;
        }

        // 检查2：HLS分片是否在更新。连续 2 个检查周期(约60s)停滞才判死，
        // 避免一次网络抖动就 kill+spawn（Windows 上易残留孤儿、并形成 CPU 脉冲）。
        if (session.isRunning && fs.existsSync(session.playlistPath)) {
          const stat = fs.statSync(session.playlistPath);
          const age = Date.now() - stat.mtimeMs;
          if (age > 30000) {
            session.stallCount = (session.stallCount || 0) + 1;
            this.logger.warn(`[健康检查] ${channelKey} 分片停滞${Math.round(age / 1000)}s（连续${session.stallCount}次）`);
            if (session.stallCount >= 2 && session.restartCount < 10) {
              session.stallCount = 0;
              session.restartCount++;
              this.logger.warn(`[健康检查] ${channelKey} 连续2次停滞，安全重启（强杀旧进程树后重拉）`);
              // restartHlsStream 内部负责换代、强杀旧进程树、清残留，这里无需先 kill
              setTimeout(() => this.restartHlsStream(channelKey), 2000);
            }
          } else {
            session.stallCount = 0;
          }
        }

        // 检查3：清理超过1小时的旧分片文件
        if (fs.existsSync(session.outputDir)) {
          const files = fs.readdirSync(session.outputDir);
          const now = Date.now();
          for (const file of files) {
            if (file.endsWith('.ts')) {
              const filePath = path.join(session.outputDir, file);
              try {
                const fstat = fs.statSync(filePath);
                if (now - fstat.mtimeMs > 3600000) {
                  fs.unlinkSync(filePath);
                }
              } catch (e) {
                // 忽略删除错误
              }
            }
          }
        }
      } catch (e) {
        this.logger.error(`[健康检查] ${channelKey} 检查异常: ${(e as Error).message}`);
      }
    }
  }

  /**
   * 模块销毁时停止所有转码会话
   */
  onModuleDestroy() {
    this.logger.log('模块销毁，停止所有HLS转码会话');
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.logger.log('HLS健康检查守护已停止');
    }
    for (const channel of this.hlsSessions.keys()) {
      this.stopHlsStream(channel);
    }
  }

  /**
   * 应用启动完成后自动恢复 HLS 直播流。
   *
   * 背景：HLS 是"按需启动"（前端调用 start 才会 spawn ffmpeg），健康检查只守护
   * 已存在的会话。后端因部署/崩溃/WeeklyReboot 重启后 hlsSessions 被清空，若现场
   * 大屏页面未刷新就不会再触发 start，表现为 ffmpeg=0、6 路画面全部停滞。这里在
   * 启动后等网络/HTTP 就绪，再错峰逐路拉起默认通道，彻底补齐该缺口。
   * - HLS_AUTOSTART=0/false/off 可整体关闭
   * - HLS_AUTOSTART_CHANNELS 可覆盖默认通道列表（逗号分隔）
   * - HLS_AUTOSTART_DELAY_MS 首路延迟（默认 8000ms）
   * - HLS_AUTOSTART_STAGGER_MS 各路错峰间隔（默认 2000ms，避免同时 spawn 冲击 CPU）
   * 单路失败只记录、不影响其它通道，也绝不阻塞应用启动。
   */
  onApplicationBootstrap(): void {
    const flag = (process.env.HLS_AUTOSTART ?? '1').toLowerCase();
    if (flag === '0' || flag === 'false' || flag === 'off') {
      this.logger.log('HLS 启动自动恢复已通过环境变量 HLS_AUTOSTART 关闭');
      return;
    }

    const rawChannels = process.env.HLS_AUTOSTART_CHANNELS?.trim();
    const channels = rawChannels
      ? rawChannels.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean)
      : [...DEFAULT_AUTOSTART_CHANNELS];
    if (channels.length === 0) {
      this.logger.warn('HLS 启动自动恢复通道列表为空，跳过');
      return;
    }

    const delayMs = Number.isFinite(parseInt(process.env.HLS_AUTOSTART_DELAY_MS || '', 10))
      ? Math.max(0, parseInt(process.env.HLS_AUTOSTART_DELAY_MS || '8000', 10))
      : 8000;
    const staggerMs = Number.isFinite(parseInt(process.env.HLS_AUTOSTART_STAGGER_MS || '', 10))
      ? Math.max(0, parseInt(process.env.HLS_AUTOSTART_STAGGER_MS || '2000', 10))
      : 2000;

    channels.forEach((channel, idx) => {
      const wait = delayMs + idx * staggerMs;
      setTimeout(() => {
        this.startHlsStream(channel)
          .then(() => this.logger.log(`[启动自恢复] 通道 ${channel} HLS 已拉起`))
          .catch((e) => this.logger.error(
            `[启动自恢复] 通道 ${channel} 拉起失败（健康检查/前端手动 start 仍可重试）: ${(e as Error).message}`,
          ));
      }, wait);
    });
    this.logger.log(`HLS 启动自动恢复已调度：${channels.join(', ')}（首路延迟 ${delayMs}ms，错峰 ${staggerMs}ms）`);
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

    this.logger.log(`启动HLS转码: ${channelKey} (${mapping.name}) -> ${outputDir}`);
    this.logger.log(`RTSP源: rtsp://${nvr.username}:****@${nvr.ip}:${nvr.rtspPort}/Streaming/Channels/${mapping.hikChannel}`);

    // FFmpeg：HEVC 子码流(XX02,640x360) -> H.264/HLS；参数统一收敛到 buildFfmpegArgs，
    // start / restart 不再各维护一份，避免两处漂移。
    const session: HlsSession = {
      channel: channelKey,
      process: undefined as unknown as ChildProcess, // spawnSessionFfmpeg 内立即回填
      outputDir,
      playlistPath,
      startedAt: Date.now(),
      restartCount: 0,
      isRunning: true,
      generation: 1,
      stopped: false,
      stallCount: 0,
    };
    this.hlsSessions.set(channelKey, session);
    // 启动前清理同一输出目录的历史孤儿 ffmpeg（后端重启后内存 Map 已空，旧 ffmpeg 可能仍在写），
    // 再 spawn，保证每路全局唯一，杜绝两个 ffmpeg 写同一 HLS 目录互相踩踏。
    this.clearOrphanFfmpeg(channelKey);
    session.process = this.spawnSessionFfmpeg(channelKey, session, rtspUrl, session.generation);

    // 等待播放列表文件生成
    await this.waitForFile(playlistPath, 15000);

    return {
      playlistUrl: `/api/cameras/${channelKey}/hls/playlist.m3u8`,
      outputDir,
    };
  }

  /** 统一构造 ffmpeg 参数（start / restart 共用，避免两份参数漂移） */
  private buildFfmpegArgs(rtspUrl: string, segmentPattern: string, playlistPath: string): string[] {
    return [
      '-rtsp_transport', 'tcp',
      '-fflags', 'nobuffer',
      '-flags', 'low_delay',
      '-i', rtspUrl,
      '-c:v', 'libx264',      // HEVC/H.265 -> H.264，浏览器 hls.js 可播
      '-preset', 'ultrafast', // 最快编码速度
      '-tune', 'zerolatency', // 最低延迟
      '-crf', '28',           // 质量/码率平衡
      '-an',                  // 监控视频禁音频
      '-f', 'hls',
      '-hls_time', '1',
      '-hls_list_size', '3',
      '-hls_flags', 'delete_segments+append_list+omit_endlist',
      '-hls_segment_filename', segmentPattern,
      '-y',
      playlistPath,
    ];
  }

  /** spawn 一路 ffmpeg 并绑定（带代际约束的）事件处理 */
  private spawnSessionFfmpeg(
    channelKey: string,
    session: HlsSession,
    rtspUrl: string,
    generation: number,
  ): ChildProcess {
    const segmentPattern = path.join(session.outputDir, 'segment_%03d.ts');
    const args = this.buildFfmpegArgs(rtspUrl, segmentPattern, session.playlistPath);
    const proc = spawn(this.ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      // GK9000(Windows) 上 ffmpeg.exe 是控制台子程序，必须隐藏窗口，避免现场桌面黑窗堆叠
      windowsHide: true,
    });
    this.bindFfmpegHandlers(channelKey, session, proc, generation);
    return proc;
  }

  /**
   * 绑定 ffmpeg 事件。关键：close 自动重启带"代际 + stopped"双闸门，
   * 被 restart 替换掉的旧进程、被 stop 的进程退出时不再 spawn，根除孤儿累积。
   */
  private bindFfmpegHandlers(
    channelKey: string,
    session: HlsSession,
    proc: ChildProcess,
    generation: number,
  ): void {
    proc.stderr?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg && (msg.includes('error') || msg.includes('Error'))) {
        this.logger.warn(`[FFmpeg ${channelKey}] ${msg.substring(0, 200)}`);
      }
    });
    proc.stdout?.on('data', () => { /* 忽略 stdout */ });

    proc.on('close', (code) => {
      if (session.stopped || session.generation !== generation || session.process !== proc) {
        this.logger.log(`[FFmpeg ${channelKey}] 旧代际(gen=${generation})进程退出 code=${code}，不再自动拉起`);
        return;
      }
      session.isRunning = false;
      this.logger.log(`[FFmpeg ${channelKey}] 进程退出，代码: ${code}`);
      if (session.restartCount < 10) {
        session.restartCount++;
        const delay = Math.min(3000 * session.restartCount, 15000);
        this.logger.log(`[FFmpeg ${channelKey}] 自动重启 (第${session.restartCount}次，延迟${delay}ms)...`);
        setTimeout(() => {
          const cur = this.hlsSessions.get(channelKey);
          if (cur && !cur.stopped && cur.generation === generation) {
            this.restartHlsStream(channelKey);
          }
        }, delay);
      } else {
        this.logger.error(`[FFmpeg ${channelKey}] 重启次数超限，停止自动重启`);
      }
    });

    proc.on('error', (err) => {
      this.logger.error(`[FFmpeg ${channelKey}] 进程错误: ${err.message}`);
      if (session.generation === generation) session.isRunning = false;
    });
  }

  /**
   * 强杀 ffmpeg 进程树。Windows 上 child.kill('SIGTERM') 对阻塞在 RTSP 读取的
   * ffmpeg 可能杀不干净、留下孤儿继续写同一 HLS 目录；统一 taskkill /T /F 杀整棵树，
   * 其它平台回退 SIGKILL。
   */
  private killProcessTree(proc: ChildProcess | undefined): void {
    if (!proc || proc.killed || typeof proc.pid !== 'number') return;
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true });
      } else {
        proc.kill('SIGKILL');
      }
    } catch (e) {
      this.logger.warn(`强杀 ffmpeg 进程树失败，回退普通 kill: ${(e as Error).message}`);
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    }
  }

  /**
   * 启动/重启前清理同一输出子目录的系统级残留 ffmpeg（历史孤儿兜底）。
   * 后端重启/pm2 reload 后内存 Map 已空，但上一代 ffmpeg 可能仍在写同一目录，
   * 这里按命令行包含的输出目录名在系统层面去重，保证每路全局最多一个 ffmpeg。
   */
  private clearOrphanFfmpeg(channelKey: string): void {
    if (process.platform !== 'win32') return;
    try {
      const like = `*tmp\\hls\\${channelKey}\\*`; // TS 中 \\ => 一个反斜杠；通道名对 -like 无特殊含义
      const ps =
        "Get-CimInstance Win32_Process -Filter \"Name='ffmpeg.exe'\" | " +
        `Where-Object { $_.CommandLine -like '${like}' } | ` +
        'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }';
      spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
        windowsHide: true,
        timeout: 8000,
      });
    } catch (e) {
      this.logger.warn(`[${channelKey}] 清理残留 ffmpeg 失败（忽略，不影响启动）: ${(e as Error).message}`);
    }
  }

  /**
   * 停止HLS转码流
   */
  stopHlsStream(channel: string): void {
    const channelKey = channel.toLowerCase();
    const session = this.hlsSessions.get(channelKey);

    if (session) {
      this.logger.log(`停止HLS转码: ${channelKey}`);
      // 先标记 stopped：该进程 close 回调将因 stopped / 代际不匹配而跳过自动重启
      session.stopped = true;
      session.isRunning = false;
      // Windows 上 SIGTERM 可能杀不死阻塞在 RTSP 读取中的 ffmpeg，统一强杀整棵进程树，避免留孤儿
      this.killProcessTree(session.process);

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
    if (!session || session.stopped) return;

    const mapping = CHANNEL_MAP[channelKey];
    const nvr = NVR_CONFIGS.find((n) => n.id === mapping?.nvrId);
    if (!mapping || !nvr) return;

    const rtspUrl = `rtsp://${nvr.username}:${encodeURIComponent(nvr.password)}@${nvr.ip}:${nvr.rtspPort}/Streaming/Channels/${mapping.hikChannel}`;

    // 代际 +1：旧进程即使稍后才真正退出，其 close 回调因 generation 不匹配会直接跳过、
    // 不再 spawn；先强杀旧进程树并清理同目录残留，再启动新进程，
    // 保证同一路在任何时刻都只有一个 ffmpeg 在写 HLS 目录。
    const generation = session.generation + 1;
    session.generation = generation;
    session.stallCount = 0;
    this.killProcessTree(session.process);
    this.clearOrphanFfmpeg(channelKey);

    session.process = this.spawnSessionFfmpeg(channelKey, session, rtspUrl, generation);
    session.isRunning = true;
    session.startedAt = Date.now();
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
