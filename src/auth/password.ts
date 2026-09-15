/**
 * Password hashing.
 *
 * `scrypt` from Node's own crypto, deliberately: it is memory-hard, it is in the
 * standard library, and it needs no native build step on a platform whose build
 * image we do not control. A dependency that fails to compile on deploy day is a
 * worse outcome than a slightly less fashionable KDF.
 *
 * The stored string carries its own parameters — `scrypt$N$r$p$salt$hash` — so
 * the cost can be raised later without invalidating everyone's password. A hash
 * that does not record how it was made can only ever be thrown away.
 *
 * Nothing here logs, echoes or returns a password. Verification is constant-time
 * on the digest, and a missing user is compared against a dummy hash by the
 * caller so that "no such account" and "wrong password" take the same time.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Cost parameters.
 *
 * N = 2^15 is 32 MB per hash. Raising it is a one-line change and old hashes keep
 * verifying — `needsRehash` reports which ones are behind. It is not set higher
 * because every concurrent login allocates this much, and a login page that can
 * be made to exhaust a small container's memory is its own vulnerability.
 */
export const SCRYPT = { N: 1 << 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
/** Node refuses the operation if it would exceed this, so it must track N, r, p. */
const MAXMEM = 256 * SCRYPT.N * SCRYPT.r;

export const MIN_PASSWORD_LENGTH = 12;
/**
 * A cap, because the whole input is hashed and an unbounded one is a cheap way to
 * make the server do arbitrary work. Well above anything a person types.
 */
export const MAX_PASSWORD_LENGTH = 200;

export class WeakPasswordError extends Error {
  constructor(readonly problems: string[]) {
    super(`That password cannot be used: ${problems.join('; ')}`);
    this.name = 'WeakPasswordError';
  }
}

/**
 * Passwords people actually choose. Not a security boundary on its own — the
 * point is to refuse the handful that would be guessed in the first few attempts
 * against a public login page.
 */
const COMMON = new Set([
  'password',
  'password1',
  'password123',
  'passw0rd',
  '123456789012',
  '1234567890123',
  'qwertyuiop123',
  'administrator',
  'letmein12345',
  'iloveyou1234',
  'dpwhpassword',
  'dpwh12345678',
  'changemenow1',
  'welcome12345',
]);

/**
 * NIST SP 800-63B, more or less: length is what matters, composition rules are
 * not required, and the useful check is against passwords that are already
 * known-guessable. No forced rotation, no "must contain a symbol".
 */
export function passwordProblems(password: string, about: { email?: string; name?: string } = {}): string[] {
  const problems: string[] = [];

  if (password.length < MIN_PASSWORD_LENGTH) {
    problems.push(`it must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    problems.push(`it must be at most ${MAX_PASSWORD_LENGTH} characters`);
  }
  if (password.trim().length === 0) {
    problems.push('it cannot be only spaces');
  }

  const flat = password.toLowerCase();
  if (COMMON.has(flat)) problems.push('it is one of the passwords tried first');

  const local = about.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 3 && flat.includes(local)) problems.push('it contains your email address');
  if (about.name && about.name.length >= 3 && flat.includes(about.name.toLowerCase())) {
    problems.push('it contains your name');
  }

  if (/^(.)\1+$/.test(password)) problems.push('it is a single repeated character');

  return problems;
}

export function assertUsablePassword(password: string, about: { email?: string; name?: string } = {}): void {
  const problems = passwordProblems(password, about);
  if (problems.length > 0) throw new WeakPasswordError(problems);
}

/** `scrypt$N$r$p$salt$hash`, base64url for the two binary fields. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { ...SCRYPT, maxmem: MAXMEM });
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

interface Parsed {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function parse(stored: string): Parsed | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [, n, r, p, salt, hash] = parts;
  const parsed = {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    salt: Buffer.from(salt, 'base64url'),
    hash: Buffer.from(hash, 'base64url'),
  };
  if (!Number.isInteger(parsed.N) || !Number.isInteger(parsed.r) || !Number.isInteger(parsed.p)) return null;
  if (parsed.N <= 1 || parsed.r < 1 || parsed.p < 1) return null;
  if (parsed.salt.length === 0 || parsed.hash.length === 0) return null;
  return parsed;
}

/**
 * Constant-time on the digest.
 *
 * A malformed or unknown stored value returns false rather than throwing: a
 * corrupt row must fail the login, not crash the endpoint and reveal by its
 * behaviour that the row exists.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;

  const maxmem = 256 * parsed.N * parsed.r;
  let derived: Buffer;
  try {
    derived = await scrypt(password.normalize('NFKC'), parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem,
    });
  } catch {
    return false;
  }
  if (derived.length !== parsed.hash.length) return false;
  return timingSafeEqual(derived, parsed.hash);
}

/** True when the stored hash was made with weaker parameters than current. */
export function needsRehash(stored: string): boolean {
  const parsed = parse(stored);
  if (!parsed) return true;
  return parsed.N < SCRYPT.N || parsed.r < SCRYPT.r || parsed.p < SCRYPT.p;
}

/**
 * A hash to compare against when the account does not exist.
 *
 * Without it, "no such user" returns immediately while "wrong password" takes as
 * long as scrypt does, and the difference tells an attacker which addresses are
 * real. Built once at import; the value is never a usable password.
 */
export const DUMMY_HASH_PROMISE: Promise<string> = hashPassword(randomBytes(32).toString('base64url'));
