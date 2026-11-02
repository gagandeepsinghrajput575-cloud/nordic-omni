import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/**
 * Password hashing using Node's built-in scrypt.
 *
 * Chosen deliberately over bcrypt/argon2: no native module to compile, which
 * matters on a low-memory machine and keeps the dependency tree empty.
 *
 * Stored format:  scrypt$<saltHex>$<hashHex>
 */

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P }).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

  const salt = parts[1];
  const expectedHex = parts[2];

  let expected: Buffer;
  try {
    expected = Buffer.from(expectedHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== KEYLEN) return false;

  const actual = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });

  // Constant-time compare to avoid leaking the hash via timing.
  return timingSafeEqual(actual, expected);
}
