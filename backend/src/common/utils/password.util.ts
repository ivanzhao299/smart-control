import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const KEYLEN = 64;
const N = 16384;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(plain, salt, KEYLEN, { N }).toString('hex');
  return `scrypt$${N}$${salt}$${hash}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const n = Number.parseInt(parts[1], 10);
  const salt = parts[2];
  const expected = Buffer.from(parts[3], 'hex');
  const actual = scryptSync(plain, salt, expected.length, { N: n });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
