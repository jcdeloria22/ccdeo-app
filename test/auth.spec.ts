/**
 * Accounts and sessions.
 *
 * This is what will stand between the register and the open internet, so the
 * tests are about the ways it could quietly fail open: an email that matches in
 * one capitalisation but not another, a disabled account that still answers, a
 * login page that reveals which addresses are real, a session that outlives its
 * revocation, a password change that leaves old sessions usable.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { migrate } from '../src/db/migrate';
import {
  DuplicateUserError,
  MAX_FAILED_ATTEMPTS,
  UnknownRoleError,
  UnknownUserError,
  UsersRepository,
} from '../src/auth/users.repository';
import {
  hashToken,
  newToken,
  sameToken,
  SESSION_IDLE_HOURS,
  SESSION_LIFETIME_HOURS,
  SessionsRepository,
} from '../src/auth/sessions.repository';
import { WeakPasswordError } from '../src/auth/password';
import type { Actor } from '../src/operator/operator';

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;

const ADMIN: Actor = {
  id: 'operator:single',
  name: 'Jayz',
  email: 'jayz@example.com',
  role: 'admin',
  authMode: 'none',
};

const PASSWORD = 'a settled decision about soils';
const OTHER = 'another perfectly fine passphrase';

describe('the token', () => {
  it('is long, random and different every time', () => {
    const a = newToken();
    const b = newToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43); // 32 bytes, base64url
  });

  it('is stored only as a hash', () => {
    const token = newToken();
    const stored = hashToken(token);
    expect(stored).not.toContain(token);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(stored);
  });

  it('compares equal only to itself', () => {
    const a = hashToken('one');
    expect(sameToken(a, a)).toBe(true);
    expect(sameToken(a, hashToken('two'))).toBe(false);
    expect(sameToken(a, 'short')).toBe(false);
  });
});

run('accounts', () => {
  let pool: Pool;
  let users: UsersRepository;
  let sessions: SessionsRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await migrate(pool);
    users = new UsersRepository(pool);
    sessions = new SessionsRepository(pool);
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    await pool.query('truncate table sessions, users cascade');
  });

  const make = (over: Partial<{ email: string; name: string; role: string; password: string }> = {}) =>
    users.create(
      { email: 'me@dpwh.gov.ph', name: 'Materials Engineer', role: 'materials_engineer', password: PASSWORD, ...over },
      ADMIN,
    );

  describe('creating one', () => {
    it('stores the person and the role their acts are performed under', async () => {
      const user = await make();
      expect(user.email).toBe('me@dpwh.gov.ph');
      expect(user.role).toBe('materials_engineer');
      expect(user.disabledAt).toBeNull();
      expect(user.mustChangePassword).toBe(false);
    });

    /** A hash must not be able to reach a response by someone spreading a user. */
    it('never returns the password or its hash', async () => {
      const user = await make();
      expect(JSON.stringify(user)).not.toContain(PASSWORD);
      expect(JSON.stringify(user).toLowerCase()).not.toContain('scrypt');
      expect((user as unknown as Record<string, unknown>).passwordHash).toBeUndefined();
    });

    it('refuses a second account for the same address, whatever the capitalisation', async () => {
      await make();
      await expect(make({ email: 'ME@DPWH.GOV.PH' })).rejects.toThrow(DuplicateUserError);
    });

    it('refuses a role that does not exist', async () => {
      await expect(make({ role: 'superuser' })).rejects.toThrow(UnknownRoleError);
      expect(() => UsersRepository.assertRole('')).toThrow(UnknownRoleError);
    });

    it('refuses a password too weak to use, before anything is written', async () => {
      await expect(make({ password: 'short' })).rejects.toThrow(WeakPasswordError);
      expect(await users.count()).toBe(0);
    });

    it('finds an account however the address was capitalised', async () => {
      const made = await make();
      expect((await users.findByEmail('ME@DPWH.GOV.PH'))?.id).toBe(made.id);
      expect((await users.findByEmail('me@dpwh.gov.ph'))?.id).toBe(made.id);
      expect(await users.findByEmail('someone@else.com')).toBeNull();
    });
  });

  describe('signing in', () => {
    it('accepts the right password', async () => {
      const made = await make();
      const out = await users.attemptLogin('me@dpwh.gov.ph', PASSWORD);
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.user.id).toBe(made.id);
    });

    it('accepts it however the address was capitalised', async () => {
      await make();
      expect((await users.attemptLogin('Me@DPWH.gov.ph', PASSWORD)).ok).toBe(true);
    });

    it('refuses the wrong password', async () => {
      await make();
      const out = await users.attemptLogin('me@dpwh.gov.ph', OTHER);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.reason).toBe('wrong-password');
    });

    it('refuses an address with no account', async () => {
      const out = await users.attemptLogin('nobody@dpwh.gov.ph', PASSWORD);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.reason).toBe('unknown');
    });

    /**
     * The login page must not be usable to find out which addresses are real.
     * The reasons differ internally, for the throttle and the record; what a
     * caller may show the person is only "that combination was not right".
     */
    it('takes comparable time whether or not the account exists', async () => {
      await make();

      const time = async (fn: () => Promise<unknown>) => {
        const t = process.hrtime.bigint();
        await fn();
        return Number(process.hrtime.bigint() - t) / 1e6;
      };

      const real = await time(() => users.attemptLogin('me@dpwh.gov.ph', OTHER));
      const fake = await time(() => users.attemptLogin('nobody@dpwh.gov.ph', OTHER));

      // Both must actually do the hashing work, not return early.
      expect(fake).toBeGreaterThan(5);
      const ratio = Math.max(real, fake) / Math.min(real, fake);
      expect(ratio, `real ${real.toFixed(0)}ms vs unknown ${fake.toFixed(0)}ms`).toBeLessThan(4);
    });

    it('refuses a disabled account even with the right password', async () => {
      const made = await make();
      await users.setDisabled(made.id, true);
      const out = await users.attemptLogin('me@dpwh.gov.ph', PASSWORD);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.reason).toBe('disabled');
    });

    it('lets a re-enabled account back in', async () => {
      const made = await make();
      await users.setDisabled(made.id, true);
      await users.setDisabled(made.id, false);
      expect((await users.attemptLogin('me@dpwh.gov.ph', PASSWORD)).ok).toBe(true);
    });

    it('records when the person last signed in', async () => {
      const made = await make();
      expect((await users.findById(made.id))?.lastLoginAt).toBeNull();
      await users.attemptLogin('me@dpwh.gov.ph', PASSWORD);
      expect((await users.findById(made.id))?.lastLoginAt).toBeInstanceOf(Date);
    });
  });

  describe('throttling', () => {
    /** A public login page without this is a free guessing oracle. */
    it('locks the account after enough wrong passwords', async () => {
      await make();
      for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
        await users.attemptLogin('me@dpwh.gov.ph', OTHER);
      }
      const out = await users.attemptLogin('me@dpwh.gov.ph', PASSWORD);
      expect(out.ok, 'the right password must not work while locked').toBe(false);
      if (!out.ok) {
        expect(out.reason).toBe('locked');
        expect(out.retryAfter).toBeInstanceOf(Date);
      }
    });

    it('does not lock on a couple of mistypes', async () => {
      await make();
      await users.attemptLogin('me@dpwh.gov.ph', OTHER);
      await users.attemptLogin('me@dpwh.gov.ph', OTHER);
      expect((await users.attemptLogin('me@dpwh.gov.ph', PASSWORD)).ok).toBe(true);
    });

    it('forgets the failures once the right password is given', async () => {
      const made = await make();
      await users.attemptLogin('me@dpwh.gov.ph', OTHER);
      await users.attemptLogin('me@dpwh.gov.ph', PASSWORD);
      const { rows } = await pool.query<{ failed_attempts: number }>(
        'select failed_attempts from users where id = $1',
        [made.id],
      );
      expect(rows[0].failed_attempts).toBe(0);
    });

    it('can be unlocked by an administrator without a password reset', async () => {
      const made = await make();
      for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) await users.attemptLogin('me@dpwh.gov.ph', OTHER);
      await users.unlock(made.id);
      expect((await users.attemptLogin('me@dpwh.gov.ph', PASSWORD)).ok).toBe(true);
    });

    it('does not lock an address that has no account, because there is nothing to lock', async () => {
      for (let i = 0; i < MAX_FAILED_ATTEMPTS + 2; i++) {
        const out = await users.attemptLogin('nobody@dpwh.gov.ph', OTHER);
        expect(out.ok).toBe(false);
        if (!out.ok) expect(out.reason).toBe('unknown');
      }
    });
  });

  describe('changing a password', () => {
    it('takes the new one and refuses the old', async () => {
      const made = await make();
      await users.setPassword(made.id, OTHER);
      expect((await users.attemptLogin('me@dpwh.gov.ph', OTHER)).ok).toBe(true);
      expect((await users.attemptLogin('me@dpwh.gov.ph', PASSWORD)).ok).toBe(false);
    });

    it('refuses one too weak to use', async () => {
      const made = await make();
      await expect(users.setPassword(made.id, 'password123')).rejects.toThrow(WeakPasswordError);
      expect((await users.attemptLogin('me@dpwh.gov.ph', PASSWORD)).ok, 'the old one still works').toBe(true);
    });

    it('clears a lockout, since the credential just changed', async () => {
      const made = await make();
      for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) await users.attemptLogin('me@dpwh.gov.ph', OTHER);
      await users.setPassword(made.id, OTHER);
      expect((await users.attemptLogin('me@dpwh.gov.ph', OTHER)).ok).toBe(true);
    });

    it('can require the person to change it at next sign-in', async () => {
      const made = await make();
      await users.setPassword(made.id, OTHER, { mustChange: true });
      expect((await users.findById(made.id))?.mustChangePassword).toBe(true);
    });

    it('refuses to act on an account that does not exist', async () => {
      await expect(users.setPassword('00000000-0000-0000-0000-000000000000', OTHER)).rejects.toThrow(UnknownUserError);
    });
  });

  describe('sessions', () => {
    it('returns the raw token once, and stores only its hash', async () => {
      const made = await make();
      const { token, session } = await sessions.open(made.id);

      const { rows } = await pool.query<{ token_hash: string }>('select token_hash from sessions where id = $1', [
        session.id,
      ]);
      expect(rows[0].token_hash).toBe(hashToken(token));
      expect(rows[0].token_hash).not.toBe(token);
    });

    it('resolves the token to the person and the role they act under', async () => {
      const made = await make();
      const { token } = await sessions.open(made.id);
      const who = await sessions.resolve(token);

      expect(who?.userId).toBe(made.id);
      expect(who?.email).toBe('me@dpwh.gov.ph');
      expect(who?.role).toBe('materials_engineer');
    });

    it('resolves nothing for a token that was never issued', async () => {
      expect(await sessions.resolve(newToken())).toBeNull();
      expect(await sessions.resolve('')).toBeNull();
    });

    it('stops resolving once signed out', async () => {
      const made = await make();
      const { token, session } = await sessions.open(made.id);
      expect(await sessions.revoke(session.id)).toBe(true);
      expect(await sessions.resolve(token)).toBeNull();
    });

    /** An administrator must be able to end access immediately. */
    it('can end every session a person has at once', async () => {
      const made = await make();
      const a = await sessions.open(made.id);
      const b = await sessions.open(made.id);

      expect(await sessions.revokeAllFor(made.id)).toBe(2);
      expect(await sessions.resolve(a.token)).toBeNull();
      expect(await sessions.resolve(b.token)).toBeNull();
    });

    it('stops resolving when the account is disabled, without touching the session', async () => {
      const made = await make();
      const { token } = await sessions.open(made.id);
      await users.setDisabled(made.id, true);
      expect(await sessions.resolve(token)).toBeNull();
    });

    it('stops resolving after the absolute expiry', async () => {
      const made = await make();
      const { token, session } = await sessions.open(made.id);
      await pool.query('update sessions set expires_at = now() - interval \'1 minute\' where id = $1', [session.id]);
      expect(await sessions.resolve(token)).toBeNull();
    });

    it('stops resolving after too long untouched', async () => {
      const made = await make();
      const { token, session } = await sessions.open(made.id);
      await pool.query(
        `update sessions set last_seen_at = now() - ($2 || ' hours')::interval where id = $1`,
        [session.id, String(SESSION_IDLE_HOURS + 1)],
      );
      expect(await sessions.resolve(token)).toBeNull();
    });

    it('keeps a session alive while it is being used', async () => {
      const made = await make();
      const { token, session } = await sessions.open(made.id);

      await pool.query(`update sessions set last_seen_at = now() - interval '1 hour' where id = $1`, [session.id]);
      expect(await sessions.resolve(token)).not.toBeNull();

      const { rows } = await pool.query<{ last_seen_at: Date }>('select last_seen_at from sessions where id = $1', [
        session.id,
      ]);
      expect(Date.now() - rows[0].last_seen_at.getTime()).toBeLessThan(5_000);
    });

    it('sets the absolute expiry from the configured lifetime', async () => {
      const made = await make();
      const { session } = await sessions.open(made.id);
      const hours = (session.expiresAt.getTime() - session.createdAt.getTime()) / 3_600_000;
      expect(Math.round(hours)).toBe(SESSION_LIFETIME_HOURS);
    });

    it('lists what is currently open, and stops listing what is not', async () => {
      const made = await make();
      const a = await sessions.open(made.id, { userAgent: 'Firefox', ip: '127.0.0.1' });
      await sessions.open(made.id, { userAgent: 'Chrome', ip: '127.0.0.1' });

      expect(await sessions.activeFor(made.id)).toHaveLength(2);
      await sessions.revoke(a.session.id);
      const left = await sessions.activeFor(made.id);
      expect(left).toHaveLength(1);
      expect(left[0].userAgent).toBe('Chrome');
    });

    it('removes only sessions long past their expiry', async () => {
      const made = await make();
      const { session } = await sessions.open(made.id);
      expect(await sessions.purgeExpired(30)).toBe(0);

      await pool.query(`update sessions set expires_at = now() - interval '60 days' where id = $1`, [session.id]);
      expect(await sessions.purgeExpired(30)).toBe(1);
    });

    it('goes with the account when the account goes', async () => {
      const made = await make();
      await sessions.open(made.id);
      await pool.query('delete from users where id = $1', [made.id]);
      const { rows } = await pool.query('select 1 from sessions where user_id = $1', [made.id]);
      expect(rows).toHaveLength(0);
    });
  });
});
