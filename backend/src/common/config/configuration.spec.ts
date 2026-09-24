import { resolve } from 'path';
import configuration from './configuration';

describe('runtime path defaults', () => {
  const originalDbPath = process.env.DB_PATH;
  const originalLogDir = process.env.LOG_DIR;

  beforeEach(() => {
    delete process.env.DB_PATH;
    delete process.env.LOG_DIR;
  });

  afterAll(() => {
    if (originalDbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = originalDbPath;
    if (originalLogDir === undefined) delete process.env.LOG_DIR;
    else process.env.LOG_DIR = originalLogDir;
  });

  it('uses the same repository-level database and log paths as migration and backup tools', () => {
    const config = configuration();

    expect(config.database.path).toBe(resolve(process.cwd(), '../database/smart-control.db'));
    expect(config.logger.dir).toBe(resolve(process.cwd(), '../logs'));
  });
});
