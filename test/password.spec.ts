/**
 * Password hashing.
 *
 * This is the file that decides whether a stolen database is a catastrophe or an
 * inconvenience, so the properties are asserted rather than assumed: that the
 * same password never produces the same stored value twice, that the stored
 * value carries the parameters needed to verify and to re-cost it later, and
 * that nothing in it can be reversed.
 */
import { describe, it, expect } from 'vitest';
import {
  assertUsablePassword,
  DUMMY_HASH_PROMISE,
  hashPassword,
  MIN_PASSWORD_LENGTH,
  needsRehash,
  passwordProblems,
  SCRYPT,
  verifyPassword,
  WeakPasswordError,
} from '../src/auth/password';

const GOOD = 'correct horse battery staple';

describe('hashing', () => {
  it('verifies the password it was made from', async () => {
    const stored = await hashPassword(GOOD);
    expect(await verifyPassword(GOOD, stored)).toBe(true);
  });

  it('refuses a password that is merely close', async () => {
    const stored = await hashPassword(GOOD);
    expect(await verifyPassword(GOOD + ' ', stored)).toBe(false);
    expect(await verifyPassword('Correct horse battery staple', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  /** A shared salt would let one cracking run cover every account at once. */
  it('salts, so the same password stores differently every time', async () => {
    const a = await hashPassword(GOOD);
    const b = await hashPassword(GOOD);
    expect(a).not.toBe(b);
    expect(await verifyPassword(GOOD, a)).toBe(true);
    expect(await verifyPassword(GOOD, b)).toBe(true);
  });

  it('never stores the password itself', async () => {
    const stored = await hashPassword(GOOD);
    expect(stored).not.toContain(GOOD);
    expect(stored.toLowerCase()).not.toContain('horse');
  });

  it('records the parameters it used, so the cost can be raised later', async () => {
    const [scheme, n, r, p] = (await hashPassword(GOOD)).split('$');
    expect(scheme).toBe('scrypt');
    expect(Number(n)).toBe(SCRYPT.N);
    expect(Number(r)).toBe(SCRYPT.r);
    expect(Number(p)).toBe(SCRYPT.p);
  });

  /** Unicode input must not depend on which normalisation the keyboard produced. */
  it('treats the same characters as the same password however they were typed', async () => {
    const composed = 'Niño de Cebu 2026';
    const decomposed = 'Niño de Cebu 2026';
    expect(composed).not.toBe(decomposed);
    expect(await verifyPassword(decomposed, await hashPassword(composed))).toBe(true);
  });
});

describe('a stored value that is not a hash', () => {
  /** A corrupt row must fail the login, not crash the endpoint. */
  it('fails the check instead of throwing', async () => {
    for (const bad of ['', 'nonsense', 'scrypt$', 'scrypt$a$b$c$d$e', 'bcrypt$1$2$3$4$5', '$$$$$']) {
      expect(await verifyPassword(GOOD, bad), bad).toBe(false);
    }
  });

  it('is reported as needing a rehash rather than silently kept', () => {
    expect(needsRehash('nonsense')).toBe(true);
  });
});

describe('re-costing', () => {
  it('leaves a current hash alone', async () => {
    expect(needsRehash(await hashPassword(GOOD))).toBe(false);
  });

  it('flags one made with weaker parameters', async () => {
    const stored = await hashPassword(GOOD);
    const weaker = stored.replace(`scrypt$${SCRYPT.N}$`, `scrypt$${SCRYPT.N >> 2}$`);
    expect(needsRehash(weaker)).toBe(true);
  });

  /** Still verifiable — otherwise raising the cost would lock everyone out. */
  it('keeps verifying an older hash, so the cost can be raised safely', async () => {
    const { scrypt } = await import('node:crypto');
    const salt = Buffer.from('0123456789abcdef');
    const old = await new Promise<Buffer>((resolve, reject) =>
      scrypt(GOOD, salt, 64, { N: 1 << 12, r: 8, p: 1 }, (e, k) => (e ? reject(e) : resolve(k))),
    );
    const stored = ['scrypt', 1 << 12, 8, 1, salt.toString('base64url'), old.toString('base64url')].join('$');

    expect(await verifyPassword(GOOD, stored)).toBe(true);
    expect(needsRehash(stored)).toBe(true);
  });
});

describe('what may be used as a password', () => {
  it('accepts a long passphrase with no symbols or digits', () => {
    expect(passwordProblems(GOOD)).toEqual([]);
  });

  it('refuses one that is too short', () => {
    expect(passwordProblems('short')).toContain(`it must be at least ${MIN_PASSWORD_LENGTH} characters`);
  });

  it('refuses the ones guessed first', () => {
    expect(passwordProblems('password123').length).toBeGreaterThan(0);
    expect(passwordProblems('welcome12345').length).toBeGreaterThan(0);
  });

  it('refuses a password built from the person it belongs to', () => {
    expect(passwordProblems('jayz-is-here-2026', { email: 'jayz@example.com' })).toContain(
      'it contains your email address',
    );
    expect(passwordProblems('Rodriguez-Rodriguez', { name: 'Rodriguez' })).toContain('it contains your name');
  });

  it('refuses one long repeated character', () => {
    expect(passwordProblems('aaaaaaaaaaaaaaaa')).toContain('it is a single repeated character');
  });

  it('does not impose composition rules, which only produce Password1!', () => {
    expect(passwordProblems('the quick brown fox jumped')).toEqual([]);
  });

  it('throws with every reason at once, so the fix takes one attempt', () => {
    try {
      assertUsablePassword('jayz', { email: 'jayz@example.com' });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(WeakPasswordError);
      expect((e as WeakPasswordError).problems.length).toBeGreaterThan(1);
    }
  });

  it('does not put the password in the error it throws', () => {
    try {
      assertUsablePassword('secret');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as Error).message).not.toContain('secret');
    }
  });
});

describe('the dummy hash', () => {
  /**
   * Compared against when no account matches, so that "no such user" and "wrong
   * password" take the same time and the login page cannot be used to discover
   * which addresses are real.
   */
  it('is a real hash that no password matches', async () => {
    const dummy = await DUMMY_HASH_PROMISE;
    expect(dummy.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword(GOOD, dummy)).toBe(false);
    expect(await verifyPassword('', dummy)).toBe(false);
  });
});
