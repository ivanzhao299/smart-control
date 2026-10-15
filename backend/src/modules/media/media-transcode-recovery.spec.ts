import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { User } from '../../entities/user.entity';
import { MediaAsset } from '../../entities/media-asset.entity';
import { MediaService } from './media.service';
import { AddUploadReservations1788618003000 } from '../../migrations/1788618003000-AddUploadReservations';
import { BindUploadTemporaryFiles1788618004000 } from '../../migrations/1788618004000-BindUploadTemporaryFiles';
import { TrackUploadInstances1788618005000 } from '../../migrations/1788618005000-TrackUploadInstances';
import { LinkUploadMedia1788618006000 } from '../../migrations/1788618006000-LinkUploadMedia';
import { TrackSystemUploadReservations1788618008000 } from '../../migrations/1788618008000-TrackSystemUploadReservations';

describe('video transcode startup recovery', () => {
  let db: DataSource;
  let root: string;
  let media: MediaService;

  beforeEach(async () => {
    db = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [User, MediaAsset],
      synchronize: true,
    }).initialize();
    await db.getRepository(User).save({
      id: 1,
      username: 'alice',
      password: 'test',
      role: 'operator',
    });
    root = await fs.mkdtemp(join(tmpdir(), 'smart-control-recovery-test-'));
    const noopLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
    };
    media = new MediaService(
      db.getRepository(MediaAsset),
      new ConfigService(),
      noopLogger as any,
    );
    Object.defineProperty(media, 'mediaRoot', { value: root });
    for (const migration of [
      new AddUploadReservations1788618003000(),
      new BindUploadTemporaryFiles1788618004000(),
      new TrackUploadInstances1788618005000(),
      new LinkUploadMedia1788618006000(),
      new TrackSystemUploadReservations1788618008000(),
    ]) {
      await migration.up(db.createQueryRunner());
    }
    // 不真的跑 ffmpeg：把合成的“转码产物”写进临时输出即可。
    jest
      .spyOn(media as any, 'runTranscode')
      .mockImplementation(async (...args: unknown[]) => {
        await fs.writeFile(args[2] as string, 'H264_PAYLOAD');
      });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await db.destroy();
    await fs.rm(root, { recursive: true, force: true });
  });

  /** 造一条“重启前没转完”的视频：处理中状态 + 孤儿临时文件 + 未释放的转码预留。 */
  async function seedInterrupted(
    status: 'pending' | 'processing',
    options: { sourceName?: string; writeSource?: boolean; existingOutput?: boolean } = {},
  ) {
    const sourceName = options.sourceName ?? 'source.mp4';
    const writeSource = options.writeSource ?? true;
    const repo = db.getRepository(MediaAsset);
    const item = await repo.save({
      originalName: sourceName,
      safeName: sourceName,
      path: join(root, 'placeholder'),
      kind: 'video',
      mimeType: 'video/mp4',
      sizeBytes: 11,
      ownerUserId: 1,
      visibility: 'private',
      uploader: 'alice',
      processingStatus: status,
    });
    const dir = join(root, String(item.id));
    await fs.mkdir(dir, { recursive: true });
    const source = join(dir, sourceName);
    if (writeSource) await fs.writeFile(source, 'HEVC_SOURCE');
    await repo.update(item.id, { path: source });
    // 上次进程被杀死，ffmpeg 留下的半成品临时文件。
    await fs.writeFile(
      join(dir, 'playback-converting-11111111-1111-1111-1111-111111111111.mp4'),
      'PARTIAL',
    );
    // 上次进程没走到 finally，转码预留还挂在账上。
    await db.query(
      'INSERT INTO upload_reservations (id, owner_user_id, bytes, target_media_id) VALUES (?, ?, ?, ?)',
      [`stale-${item.id}`, 1, 4096, item.id],
    );
    if (options.existingOutput) {
      // rename 已完成、但 DB 尚未回写 ready 的极端窗口。
      await fs.writeFile(join(dir, 'playback.mp4'), 'STALE_OUTPUT');
    }
    return { item, dir, source };
  }

  it.each(['pending', 'processing'])(
    're-runs a %s video left behind after restart, clearing orphan temp and stale reservation',
    async (status) => {
      const { item, dir, source } = await seedInterrupted(status as 'pending' | 'processing');
      jest.spyOn(media as any, 'probeVideo').mockResolvedValue({
        videoCodec: 'hevc',
        audioCodec: 'aac',
        width: 3612,
        height: 1462,
        duration: 215,
      });

      await (media as any).recoverInterruptedVideos();

      const fresh = await db.getRepository(MediaAsset).findOneByOrFail({ id: item.id });
      expect(fresh.processingStatus).toBe('ready');
      expect(fresh.processingError).toBeNull();
      expect(fresh.path).toBe(join(dir, 'playback.mp4'));
      expect(fresh.sourcePath).toBe(source);
      expect(fresh.resolution).toBe('3612x1462');
      expect(fresh.durationSec).toBe(215);
      expect(await fs.readFile(join(dir, 'playback.mp4'), 'utf8')).toBe('H264_PAYLOAD');
      const entries = await fs.readdir(dir);
      expect(entries.some((name) => name.startsWith('playback-converting-'))).toBe(false);
      expect(await fs.readFile(source, 'utf8')).toBe('HEVC_SOURCE'); // 原片保留
      expect(await db.query('SELECT id FROM upload_reservations')).toEqual([]);
    },
  );

  it('does not touch videos already ready', async () => {
    const repo = db.getRepository(MediaAsset);
    const dir = join(root, '1');
    await fs.mkdir(dir, { recursive: true });
    const source = join(dir, 'ready.mp4');
    await fs.writeFile(source, 'H264_SOURCE');
    await repo.save({
      originalName: 'ready.mp4',
      safeName: 'ready.mp4',
      path: source,
      kind: 'video',
      mimeType: 'video/mp4',
      sizeBytes: 11,
      ownerUserId: 1,
      visibility: 'private',
      uploader: 'alice',
      processingStatus: 'ready',
    });
    const probe = jest.spyOn(media as any, 'probeVideo');

    await (media as any).recoverInterruptedVideos();

    expect(probe).not.toHaveBeenCalled();
    expect(await fs.readdir(dir)).toEqual(['ready.mp4']);
  });

  it('marks a video failed when its source is gone without blocking later recovery', async () => {
    const broken = await seedInterrupted('processing', { sourceName: 'lost.mp4', writeSource: false });
    const healthy = await seedInterrupted('processing', { sourceName: 'good.mp4' });
    // 真实 ffprobe 对不存在文件会失败：用 fs.access 复现这一点。
    jest.spyOn(media as any, 'probeVideo').mockImplementation(async (...args: unknown[]) => {
      await fs.access(args[0] as string);
      return { videoCodec: 'hevc', audioCodec: 'aac', width: 1920, height: 1080, duration: 10 };
    });

    await (media as any).recoverInterruptedVideos();

    const brokenRow = await db.getRepository(MediaAsset).findOneByOrFail({ id: broken.item.id });
    const healthyRow = await db.getRepository(MediaAsset).findOneByOrFail({ id: healthy.item.id });
    expect(brokenRow.processingStatus).toBe('failed');
    expect(healthyRow.processingStatus).toBe('ready');
    expect(healthyRow.path).toBe(join(healthy.dir, 'playback.mp4'));
  });

  it('overwrites an existing playback output when re-transcoding after restart', async () => {
    const { item, dir } = await seedInterrupted('processing', { existingOutput: true });
    jest.spyOn(media as any, 'probeVideo').mockResolvedValue({
      videoCodec: 'hevc',
      audioCodec: 'aac',
      width: 1280,
      height: 720,
      duration: 5,
    });

    await (media as any).recoverInterruptedVideos();

    const fresh = await db.getRepository(MediaAsset).findOneByOrFail({ id: item.id });
    expect(fresh.processingStatus).toBe('ready');
    expect(fresh.path).toBe(join(dir, 'playback.mp4'));
    expect(await fs.readFile(join(dir, 'playback.mp4'), 'utf8')).toBe('H264_PAYLOAD');
  });
});
