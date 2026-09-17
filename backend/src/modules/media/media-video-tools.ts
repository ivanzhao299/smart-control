import { spawn } from 'child_process';
import { boundedCommandFile } from '../../common/utils/bounded-command-file';

export interface VideoProbe {
  videoCodec?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
  duration?: number;
}

/** Narrow process boundary: no repositories, application credentials or device commands. */
export interface MediaVideoTools {
  status(): Promise<{ ffmpeg: boolean; ffprobe: boolean }>;
  probe(file: string): Promise<VideoProbe>;
  transcode(args: string[], output: string, maxBytes: number): Promise<void>;
}

export class FfmpegMediaTools implements MediaVideoTools {
  async status(): Promise<{ ffmpeg: boolean; ffprobe: boolean }> {
    const [ffmpeg, ffprobe] = await Promise.all([
      this.runCommand(this.command('ffmpeg'), ['-version']).then(
        () => true,
        () => false,
      ),
      this.runCommand(this.command('ffprobe'), ['-version']).then(
        () => true,
        () => false,
      ),
    ]);
    return { ffmpeg, ffprobe };
  }

  async probe(file: string): Promise<VideoProbe> {
    const output = await this.runCommand(
      this.command('ffprobe'),
      [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_type,codec_name,width,height:format=duration',
        '-of',
        'json',
        file,
      ],
      60_000,
    );
    const parsed = JSON.parse(output) as {
      streams?: Array<{ codec_type: string; codec_name?: string; width?: number; height?: number }>;
      format?: { duration?: string };
    };
    const video = parsed.streams?.find((stream) => stream.codec_type === 'video');
    const audio = parsed.streams?.find((stream) => stream.codec_type === 'audio');
    if (!video) throw new Error('文件中没有视频轨');
    return {
      videoCodec: video.codec_name,
      audioCodec: audio?.codec_name,
      width: video.width,
      height: video.height,
      duration: Number(parsed.format?.duration) || undefined,
    };
  }

  transcode(args: string[], output: string, maxBytes: number): Promise<void> {
    return boundedCommandFile(this.command('ffmpeg'), args, output, maxBytes);
  }

  private command(tool: 'ffmpeg' | 'ffprobe'): string {
    return (
      process.env[tool === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH'] ||
      (process.platform === 'win32' ? `D:\\smart-control-tools\\ffmpeg\\bin\\${tool}.exe` : tool)
    );
  }

  private runCommand(command: string, args: string[], timeoutMs = 15_000): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const stdout: Buffer[] = [];
      let stdoutBytes = 0;
      let stderr = Buffer.alloc(0);
      let failure: Error | undefined;
      let settled = false;
      const stop = (error: Error) => {
        if (settled || failure) return;
        failure = error;
        child.kill('SIGKILL');
      };
      const timer = setTimeout(() => stop(new Error(`媒体探测超时 (${timeoutMs}ms)`)), timeoutMs);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(Buffer.concat(stdout).toString('utf8'));
      };
      child.stdout.on('data', (chunk: Buffer) => {
        if (failure || settled) return;
        if (chunk.length > 2_000_000 - stdoutBytes) {
          stop(new Error('媒体探测输出超过大小限制'));
          return;
        }
        stdout.push(chunk);
        stdoutBytes += chunk.length;
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = Buffer.concat([stderr, chunk.subarray(-8000)]).subarray(-8000);
      });
      child.stdout.once('error', stop);
      child.stderr.once('error', stop);
      child.once('error', finish);
      // Wait for process close before releasing the media operation lock.
      child.once('close', (code) =>
        finish(
          failure ??
            (code === 0
              ? undefined
              : new Error(`${command} 退出码 ${code}: ${stderr.toString('utf8').slice(-2000)}`)),
        ),
      );
    });
  }
}
