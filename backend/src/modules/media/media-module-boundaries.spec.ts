import { readFileSync } from 'fs';
import { join } from 'path';
import ts from 'typescript';

/** Lock in the new responsibility edges so future changes do not fold them back into the facade. */
describe('media responsibility boundaries', () => {
  const imports = (name: string) => {
    const source = ts.createSourceFile(
      name,
      readFileSync(join(__dirname, name), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    return source.statements
      .filter(ts.isImportDeclaration)
      .map((statement) => (statement.moduleSpecifier as ts.StringLiteral).text);
  };
  it.each([
    ['media-file-policy.ts', ['path', '../../entities/media-asset.entity']],
    ['media-video-tools.ts', ['child_process', '../../common/utils/bounded-command-file']],
    [
      'media-byte-stream.ts',
      ['@nestjs/common', 'fs', 'path', '../../entities/media-asset.entity', './byte-range'],
    ],
    [
      'media-video-processor.ts',
      [
        '@nestjs/common',
        'typeorm',
        'fs',
        'path',
        'crypto',
        'winston',
        '../../entities/media-asset.entity',
        '../../common/utils/serialized-transaction',
        './media-quota.service',
        './media-video-tools',
      ],
    ],
  ] as const)(
    '%s cannot import the catalog facade, controllers, or other domains',
    (file, allowed) => {
      expect(
        imports(file).filter((name) => !(allowed as readonly string[]).includes(name)),
      ).toEqual([]);
    },
  );

  it('keeps process execution, byte ranges and classification implementations out of the catalog facade', () => {
    const source = readFileSync(join(__dirname, 'media.service.ts'), 'utf8');
    expect(imports('media.service.ts')).not.toContain('child_process');
    expect(imports('media.service.ts')).not.toContain('../../common/utils/bounded-command-file');
    expect(imports('media.service.ts')).not.toContain('./byte-range');
    expect(source).not.toMatch(
      /private (async )?(probeVideo|runTranscode|ffmpegCommand|runCommand|safeFilename)\(/,
    );
    expect(source).not.toContain('const EXT_KIND_MIME');
  });
});
