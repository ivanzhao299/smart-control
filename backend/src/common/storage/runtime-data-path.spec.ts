import { resolveRuntimeDataDir } from './runtime-data-path';

describe('resolveRuntimeDataDir', () => {
  it('honours an explicit DATA_DIR', () => {
    expect(resolveRuntimeDataDir({ DATA_DIR: '/srv/control-data' }, 'linux', '/app/backend'))
      .toBe('/srv/control-data');
  });

  it('uses the protected production drive on Windows', () => {
    expect(resolveRuntimeDataDir({}, 'win32', 'D:\\smart-control\\backend'))
      .toBe('D:\\smart-control-runtime\\data');
  });

  it('keeps development runtime data outside backend', () => {
    expect(resolveRuntimeDataDir({}, 'darwin', '/workspace/smart-control/backend'))
      .toBe('/workspace/smart-control/.runtime/data');
  });
});
