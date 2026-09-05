import { byteRange } from './byte-range';

describe('media single range parsing', () => {
  it.each([
    [undefined, 100, { start: 0, end: 99, partial: false }],
    ['bytes=0-0', 100, { start: 0, end: 0, partial: true }],
    ['bytes=50-', 100, { start: 50, end: 99, partial: true }],
    ['bytes=-20', 100, { start: 80, end: 99, partial: true }],
    ['bytes=80-200', 100, { start: 80, end: 99, partial: true }],
    ['bytes=-200', 100, { start: 0, end: 99, partial: true }],
    [undefined, 0, { start: 0, end: -1, partial: false }],
  ])('parses %s for size %s', (header, size, expected) => {
    expect(byteRange(header as string | undefined, size as number)).toEqual(expected);
  });
  it.each(['bytes=100-', 'bytes=40-20', 'bytes=-0', 'bytes=-', 'bytes=0-1,5-6', 'items=0-1', 'bytes=9007199254740992-', 'bytes=0-9007199254740992'])
    ('rejects unsatisfiable or unsupported range %s', header => expect(byteRange(header, 100)).toBeNull());
  it('rejects ranges on empty files', () => expect(byteRange('bytes=0-', 0)).toBeNull());
});
