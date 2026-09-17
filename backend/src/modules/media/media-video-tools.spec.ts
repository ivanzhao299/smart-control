import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { boundedCommandFile } from '../../common/utils/bounded-command-file';
import { FfmpegMediaTools } from './media-video-tools';

jest.mock('child_process', () => ({ spawn: jest.fn() }));
jest.mock('../../common/utils/bounded-command-file', () => ({ boundedCommandFile: jest.fn() }));

function childFixture() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: jest.fn(),
  });
  (spawn as jest.Mock).mockReturnValueOnce(child);
  return child;
}

describe('FFmpeg media tool boundary', () => {
  const oldFfmpeg = process.env.FFMPEG_PATH,
    oldFfprobe = process.env.FFPROBE_PATH;
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    if (oldFfmpeg === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = oldFfmpeg;
    if (oldFfprobe === undefined) delete process.env.FFPROBE_PATH;
    else process.env.FFPROBE_PATH = oldFfprobe;
  });

  it('passes paths as arguments without a shell and parses real probe metadata', async () => {
    process.env.FFPROBE_PATH = '/tools with spaces/ffprobe';
    const child = childFixture();
    const pending = new FfmpegMediaTools().probe('/media/a;touch not-a-command.mov');
    expect(spawn).toHaveBeenCalledWith(
      '/tools with spaces/ffprobe',
      expect.arrayContaining(['/media/a;touch not-a-command.mov']),
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    child.stdout.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          streams: [
            { codec_type: 'video', codec_name: 'h264', width: 3612, height: 1462 },
            { codec_type: 'audio', codec_name: 'aac' },
          ],
          format: { duration: '10.5' },
        }),
      ),
    );
    child.emit('close', 0);
    await expect(pending).resolves.toEqual({
      videoCodec: 'h264',
      audioCodec: 'aac',
      width: 3612,
      height: 1462,
      duration: 10.5,
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('checks both executables independently and clears timers after spawn failure', async () => {
    const encoder = childFixture(),
      probe = childFixture();
    const pending = new FfmpegMediaTools().status();
    encoder.stdout.emit('data', Buffer.from('FFmpeg fixture'));
    encoder.emit('close', 0);
    probe.emit('error', new Error('ENOENT'));
    probe.emit('close', -2);
    await expect(pending).resolves.toEqual({ ffmpeg: true, ffprobe: false });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('retains the existing Windows installed-tool paths without environment overrides', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    try {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      delete process.env.FFMPEG_PATH;
      delete process.env.FFPROBE_PATH;
      const encoder = childFixture(),
        probe = childFixture();
      const pending = new FfmpegMediaTools().status();
      expect((spawn as jest.Mock).mock.calls.map((call) => call[0])).toEqual([
        'D:\\smart-control-tools\\ffmpeg\\bin\\ffmpeg.exe',
        'D:\\smart-control-tools\\ffmpeg\\bin\\ffprobe.exe',
      ]);
      encoder.emit('close', 0);
      probe.emit('close', 0);
      await expect(pending).resolves.toEqual({ ffmpeg: true, ffprobe: true });
    } finally {
      Object.defineProperty(process, 'platform', platform);
    }
  });

  it('bounds status checks to fifteen seconds and reports only the failed tool unavailable', async () => {
    const encoder = childFixture(),
      probe = childFixture();
    const pending = new FfmpegMediaTools().status();
    probe.emit('close', 0);
    jest.advanceTimersByTime(15_000);
    expect(encoder.kill).toHaveBeenCalledWith('SIGKILL');
    expect(probe.kill).not.toHaveBeenCalled();
    encoder.emit('close', null);
    await expect(pending).resolves.toEqual({ ffmpeg: false, ffprobe: true });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('terminates a hung probe at its deadline but awaits process close before settling', async () => {
    const child = childFixture();
    let settled = false;
    const pending = new FfmpegMediaTools().probe('/fixture.mp4');
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    const rejected = expect(pending).rejects.toThrow('媒体探测超时');
    jest.advanceTimersByTime(60_000);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    await Promise.resolve();
    expect(settled).toBe(false);
    child.emit('close', null);
    await rejected;
    expect(jest.getTimerCount()).toBe(0);
  });

  it('caps diagnostic stdout and kills an overflowing child without retaining excess output', async () => {
    const child = childFixture();
    const pending = new FfmpegMediaTools().probe('/fixture.mp4');
    const rejected = expect(pending).rejects.toThrow('媒体探测输出超过大小限制');
    child.stdout.emit('data', Buffer.alloc(2_000_001));
    expect(child.kill).toHaveBeenCalledTimes(1);
    child.stdout.emit('data', Buffer.alloc(2_000_001));
    child.emit('close', null);
    await rejected;
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['not-json', '{"streams":[]}'])(
    'rejects malformed or video-less probe data: %s',
    async (text) => {
      const child = childFixture();
      const pending = new FfmpegMediaTools().probe('/fixture');
      child.stdout.emit('data', Buffer.from(text));
      child.emit('close', 0);
      await expect(pending).rejects.toThrow();
    },
  );

  it('retains only bounded stderr diagnostics for failed commands', async () => {
    const child = childFixture();
    const pending = new FfmpegMediaTools().probe('/fixture');
    child.stderr.emit('data', Buffer.from('x'.repeat(100_000) + 'last-error'));
    child.emit('close', 1);
    await expect(pending).rejects.toThrow('last-error');
    await expect(pending.catch((error) => error.message.length)).resolves.toBeLessThan(2100);
  });

  it('delegates transcode output to the exclusive bounded file writer without changing arguments or budget', async () => {
    process.env.FFMPEG_PATH = '/tools/ffmpeg';
    (boundedCommandFile as jest.Mock).mockResolvedValue(undefined);
    await new FfmpegMediaTools().transcode(['-i', '/original.mov', 'pipe:1'], '/new.mp4', 500);
    expect(boundedCommandFile).toHaveBeenCalledWith(
      '/tools/ffmpeg',
      ['-i', '/original.mov', 'pipe:1'],
      '/new.mp4',
      500,
    );
    expect(spawn).not.toHaveBeenCalled();
  });
});
