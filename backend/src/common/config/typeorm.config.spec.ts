import { ConfigService } from '@nestjs/config';
import { TypeOrmConfigService } from './typeorm.config';

describe('production schema mutation guard', () => {
  it('refuses automatic synchronize before opening or creating a database path', () => {
    const service = new TypeOrmConfigService(new ConfigService({ database: { synchronize: true, path: '/not-created-by-this-test/database.sqlite' } }));
    expect(() => service.createTypeOrmOptions()).toThrow('explicit migrations');
  });
});
