import { readFileSync } from 'fs';
import { resolve } from 'path';
import { toHikvisionSubstreamChannel } from './cameras.service';

describe('camera stream configuration source', () => {
  it.each([
    ['3701', '3702'],
    ['201', '202'],
    ['5702', '5702'],
    ['custom', 'custom'],
  ])('maps Hikvision channel %s to safe HLS substream %s', (input, expected) => {
    expect(toHikvisionSubstreamChannel(input)).toBe(expected);
  });

  it('contains no duplicate NVR or channel configuration in CamerasService', () => {
    const source = readFileSync(resolve(__dirname, 'cameras.service.ts'), 'utf8');
    expect(source).not.toContain('NVR_CONFIGS');
    expect(source).not.toContain('CHANNEL_MAP');
    expect(source).not.toMatch(/password:\s*['"]/);
    expect(source).toContain('videoBinding.resolveStreamBinding');
  });

  it('registers the fixed HLS status route before the generic segment route', () => {
    const source = readFileSync(resolve(__dirname, 'cameras.controller.ts'), 'utf8');
    const statusRoute = source.indexOf("@Get(':channel/hls/status')");
    const segmentRoute = source.indexOf("@Get(':channel/hls/:filename')");

    expect(statusRoute).toBeGreaterThanOrEqual(0);
    expect(segmentRoute).toBeGreaterThan(statusRoute);
  });

  it('keeps park operations metrics writes behind the versioned runtime store', () => {
    const controller = readFileSync(resolve(__dirname, 'park-ops-metrics.controller.ts'), 'utf8');
    const service = readFileSync(resolve(__dirname, 'park-ops-metrics.service.ts'), 'utf8');

    expect(controller).not.toMatch(/writeFile|renameSync|copyFile/);
    expect(controller).toContain('this.metrics.update');
    expect(service).toContain('this.store.update');
    expect(service).not.toMatch(/writeFile|renameSync|copyFile/);
  });

  it('keeps NVR credentials out of code defaults and AI reference URLs', () => {
    const projectRoot = resolve(__dirname, '../../../..');
    for (const file of [
      'backend/src/modules/cameras/video-binding-config.ts',
      'backend/src/modules/cameras/cameras.service.ts',
      'ai-analyzer-reference/video_ai_analyzer.production.py',
      'ai-analyzer-reference/video_ai_analyzer.new.py',
    ]) {
      const source = readFileSync(resolve(projectRoot, file), 'utf8');
      expect(source).not.toMatch(/rtsp:\/\/[A-Za-z0-9._-]+:[A-Za-z0-9._-]+@/);
      expect(source).not.toMatch(/password:\s*['"][^'"]+['"]/i);
    }
  });
});
