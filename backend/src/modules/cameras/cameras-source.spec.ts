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
