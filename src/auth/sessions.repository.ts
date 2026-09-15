/**
 * Sessions.
 *
 * Server-side, not a self-contained signed token. A JWT cannot be revoked before
 * it expires, and this system has an administrator who must be able to end
 * someone's access immediately — a contractor's engineer leaves, a laptop is
 * lost. That is worth a database round trip per request.
 *
 * The cookie holds a random 256-bit value. Only its SHA-256 is stored, for the
 * same reason passwords are not stored: a leaked database must not hand over
 * live sessions. A hash is enough because, unlike a password, the value is
 * already high-entropy — no salt or KDF is needed, and a fast hash is wanted so
 * that lookup stays cheap.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import type { Role } from '../policy/roles';

/** How long a session lives at most, and how long it survives being ignored. */
export const SESSION_LIFETIME_HOURS = 12;
export const SESSION_IDLE_HOURS = 2;

export interface Session {
  readonly id: string;
  readonly userId: string;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly userAgent: string | null;
  readonly ip: string | null;
}

/** A session plus who it belongs to — one query, because every request needs both. */
export interface SessionUser {
  readonly sessionId: string;
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  readonly mustChangePassword: boolean;
}

interface JoinRow {
  session_id: string;
  user_id: string;
  email: string;
  name: string;
  role: Role;
  must_change_password: boolean;
  disabled_at: Date | null;
  expires_at: Date;
  last_seen_at: Date;
  revoked_at: Date | null;
}

export const TOKEN_BYTES = 32;

export function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Compare two token hashes without leaking where they differ.
 *
 * The lookup is by hash so the database has already done the comparison, but
 * anywhere this project compares a secret it does so in constant time rather
 * than leaving a `===` for someone to reason about later.
 */
export function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

export class SessionsRepository {
  constructor(private readonly pool: Pool) {}

  /** Returns the raw token — the only time it exists — and the stored session. */
  async open(
    userId: string,
    context: { userAgent?: string | null; ip?: string | null } = {},
  ): Promise<{ token: string; session: Session }> {
    const token = newToken();
    const { rows } = await this.pool.query<{
      id: string;
      user_id: string;
      created_at: Date;
      last_seen_at: Date;
      expires_at: Date;
      revoked_at: Date | null;
      user_agent: string | null;
      ip: string | null;
    }>(
      `insert into sessions (token_hash, user_id, expires_at, user_agent, ip)
       values ($1, $2, now() + ($3 || ' hours')::interval, $4, $5)
       returning id, user_id, created_at, last_seen_at, expires_at, revoked_at, user_agent, ip`,
      [hashToken(token), userId, String(SESSION_LIFETIME_HOURS), context.userAgent ?? null, context.ip ?? null],
    );
    const r = rows[0];
    return {
      token,
      session: {
        id: r.id,
        userId: r.user_id,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
        expiresAt: r.expires_at,
        revokedAt: r.revoked_at,
        userAgent: r.user_agent,
        ip: r.ip,
      },
    };
  }

  /**
   * The user behind a cookie, or null.
   *
   * Every reason to reject returns the same null: expired, idle too long,
   * revoked, no such session, or the account disabled since. The caller cannot
   * accidentally treat "disabled" as "signed in", and the response gives nothing
   * away about which it was.
   *
   * `last_seen_at` is advanced on a successful lookup, which is what makes the
   * idle timeout mean anything.
   */
  async resolve(token: string): Promise<SessionUser | null> {
    const { rows } = await this.pool.query<JoinRow>(
      `select s.id as session_id, s.expires_at, s.last_seen_at, s.revoked_at,
              u.id as user_id, u.email, u.name, u.role, u.must_change_password, u.disabled_at
         from sessions s
         join users u on u.id = s.user_id
        where s.token_hash = $1`,
      [hashToken(token)],
    );
    if (rows.length === 0) return null;

    const r = rows[0];
    const now = Date.now();
    if (r.revoked_at) return null;
    if (r.disabled_at) return null;
    if (r.expires_at.getTime() <= now) return null;
    if (now - r.last_seen_at.getTime() > SESSION_IDLE_HOURS * 3_600_000) return null;

    await this.pool.query('update sessions set last_seen_at = now() where id = $1', [r.session_id]);

    return {
      sessionId: r.session_id,
      userId: r.user_id,
      email: r.email,
      name: r.name,
      role: r.role,
      mustChangePassword: r.must_change_password,
    };
  }

  /** Sign out. Kept rather than deleted, so "ended at" stays answerable. */
  async revoke(sessionId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'update sessions set revoked_at = now() where id = $1 and revoked_at is null',
      [sessionId],
    );
    return (rowCount ?? 0) > 0;
  }

  /** Every session for one person — a password change, or an administrator. */
  async revokeAllFor(userId: string): Promise<number> {
    const { rowCount } = await this.pool.query(
      'update sessions set revoked_at = now() where user_id = $1 and revoked_at is null',
      [userId],
    );
    return rowCount ?? 0;
  }

  async activeFor(userId: string): Promise<Session[]> {
    const { rows } = await this.pool.query<{
      id: string;
      user_id: string;
      created_at: Date;
      last_seen_at: Date;
      expires_at: Date;
      revoked_at: Date | null;
      user_agent: string | null;
      ip: string | null;
    }>(
      `select id, user_id, created_at, last_seen_at, expires_at, revoked_at, user_agent, ip
         from sessions
        where user_id = $1 and revoked_at is null and expires_at > now()
        order by last_seen_at desc`,
      [userId],
    );
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      createdAt: r.created_at,
      lastSeenAt: r.last_seen_at,
      expiresAt: r.expires_at,
      revokedAt: r.revoked_at,
      userAgent: r.user_agent,
      ip: r.ip,
    }));
  }

  /**
   * Remove sessions that can no longer authenticate anyone.
   *
   * Only rows already past their absolute expiry, and only after a grace period,
   * so a recently-ended session is still visible to someone asking what happened.
   */
  async purgeExpired(olderThanDays = 30): Promise<number> {
    const { rowCount } = await this.pool.query(
      `delete from sessions where expires_at < now() - ($1 || ' days')::interval`,
      [String(olderThanDays)],
    );
    return rowCount ?? 0;
  }
}
