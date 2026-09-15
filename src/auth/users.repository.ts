/**
 * Accounts.
 *
 * The repository owns three things the rest of the system must not have to think
 * about: that an email identifies one account however it was capitalised, that a
 * password only ever enters as plaintext and leaves as a hash, and that a user
 * who has signed something is disabled rather than deleted.
 *
 * `passwordHash` is deliberately absent from the `User` returned to callers. It
 * is fetched only by `findForLogin`, which is the one place that needs it, so a
 * hash cannot reach a response body by someone spreading a user object into JSON.
 */
import type { Pool, PoolClient } from 'pg';
import type { Actor } from '../operator/operator';
import { ROLES, type Role } from '../policy/roles';
import { assertUsablePassword, hashPassword, needsRehash, verifyPassword, DUMMY_HASH_PROMISE } from './password';

export interface User {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  readonly mustChangePassword: boolean;
  readonly disabledAt: Date | null;
  readonly lockedUntil: Date | null;
  readonly lastLoginAt: Date | null;
  readonly createdAt: Date;
}

interface Row {
  id: string;
  email: string;
  name: string;
  role: Role;
  must_change_password: boolean;
  disabled_at: Date | null;
  locked_until: Date | null;
  last_login_at: Date | null;
  created_at: Date;
}

const COLUMNS = `id, email, name, role, must_change_password, disabled_at, locked_until, last_login_at, created_at`;

const toUser = (r: Row): User => ({
  id: r.id,
  email: r.email,
  name: r.name,
  role: r.role,
  mustChangePassword: r.must_change_password,
  disabledAt: r.disabled_at,
  lockedUntil: r.locked_until,
  lastLoginAt: r.last_login_at,
  createdAt: r.created_at,
});

export class DuplicateUserError extends Error {
  constructor(email: string) {
    super(`An account already exists for ${email}.`);
    this.name = 'DuplicateUserError';
  }
}

export class UnknownUserError extends Error {
  constructor(id: string) {
    super(`No account ${id}.`);
    this.name = 'UnknownUserError';
  }
}

export class UnknownRoleError extends Error {
  constructor(role: string) {
    super(`No role called "${role}". Known roles: ${ROLES.join(', ')}.`);
    this.name = 'UnknownRoleError';
  }
}

/**
 * How many wrong passwords before the account stops answering, and for how long.
 *
 * Per account rather than per address seen, because the thing being protected is
 * the account. Ten is generous enough that a person mistyping twice is never
 * affected and small enough that guessing is hopeless.
 */
export const MAX_FAILED_ATTEMPTS = 10;
export const LOCK_MINUTES = 15;

export type LoginOutcome =
  | { ok: true; user: User; rehashed: boolean }
  | { ok: false; reason: 'unknown' | 'wrong-password' | 'disabled' | 'locked'; retryAfter?: Date };

export class UsersRepository {
  constructor(private readonly pool: Pool) {}

  static assertRole(role: string): asserts role is Role {
    if ((ROLES as readonly string[]).includes(role) === false) throw new UnknownRoleError(role);
  }

  async count(): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>('select count(*) as n from users');
    return Number(rows[0].n);
  }

  async list(): Promise<User[]> {
    const { rows } = await this.pool.query<Row>(`select ${COLUMNS} from users order by lower(email)`);
    return rows.map(toUser);
  }

  async findById(id: string): Promise<User | null> {
    const { rows } = await this.pool.query<Row>(`select ${COLUMNS} from users where id = $1`, [id]);
    return rows.length ? toUser(rows[0]) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const { rows } = await this.pool.query<Row>(`select ${COLUMNS} from users where lower(email) = lower($1)`, [email]);
    return rows.length ? toUser(rows[0]) : null;
  }

  async create(
    input: { email: string; name: string; role: string; password: string; mustChangePassword?: boolean },
    actor: Actor,
    client?: PoolClient,
  ): Promise<User> {
    UsersRepository.assertRole(input.role);
    assertUsablePassword(input.password, { email: input.email, name: input.name });

    const hash = await hashPassword(input.password);
    const q = client ?? this.pool;
    try {
      const { rows } = await q.query<Row>(
        `insert into users (email, name, role, password_hash, must_change_password, created_by, created_by_role)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning ${COLUMNS}`,
        [
          input.email.trim(),
          input.name.trim(),
          input.role,
          hash,
          input.mustChangePassword ?? false,
          actor.id,
          actor.role,
        ],
      );
      return toUser(rows[0]);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new DuplicateUserError(input.email);
      throw e;
    }
  }

  /**
   * Check an email and password.
   *
   * Every failing path does the same work: when no account matches, the supplied
   * password is still verified against a dummy hash, so the response time cannot
   * be used to discover which addresses are registered. The reason is returned
   * for the audit and the throttle — never for the message shown to the person,
   * which says only that the combination was not right.
   */
  async attemptLogin(email: string, password: string): Promise<LoginOutcome> {
    const { rows } = await this.pool.query<Row & { password_hash: string }>(
      `select ${COLUMNS}, password_hash from users where lower(email) = lower($1)`,
      [email],
    );

    if (rows.length === 0) {
      await verifyPassword(password, await DUMMY_HASH_PROMISE);
      return { ok: false, reason: 'unknown' };
    }

    const row = rows[0];
    const user = toUser(row);

    if (row.locked_until && row.locked_until.getTime() > Date.now()) {
      await verifyPassword(password, await DUMMY_HASH_PROMISE);
      return { ok: false, reason: 'locked', retryAfter: row.locked_until };
    }

    const correct = await verifyPassword(password, row.password_hash);

    if (!correct) {
      await this.recordFailure(row.id);
      return { ok: false, reason: 'wrong-password' };
    }

    /*
     * Disabled is checked after the password on purpose. Checking it first makes
     * a disabled account answer differently from a wrong password, which tells an
     * attacker the address is real.
     */
    if (row.disabled_at) return { ok: false, reason: 'disabled' };

    let rehashed = false;
    if (needsRehash(row.password_hash)) {
      await this.pool.query('update users set password_hash = $2, updated_at = now() where id = $1', [
        row.id,
        await hashPassword(password),
      ]);
      rehashed = true;
    }

    await this.pool.query(
      'update users set failed_attempts = 0, locked_until = null, last_login_at = now() where id = $1',
      [row.id],
    );

    return { ok: true, user, rehashed };
  }

  private async recordFailure(id: string): Promise<void> {
    await this.pool.query(
      `update users
          set failed_attempts = failed_attempts + 1,
              locked_until = case when failed_attempts + 1 >= $2
                                  then now() + ($3 || ' minutes')::interval
                                  else locked_until end,
              updated_at = now()
        where id = $1`,
      [id, MAX_FAILED_ATTEMPTS, String(LOCK_MINUTES)],
    );
  }

  async setPassword(id: string, password: string, opts: { mustChange?: boolean } = {}): Promise<void> {
    const user = await this.findById(id);
    if (!user) throw new UnknownUserError(id);
    assertUsablePassword(password, { email: user.email, name: user.name });

    const { rowCount } = await this.pool.query(
      `update users
          set password_hash = $2,
              must_change_password = $3,
              failed_attempts = 0,
              locked_until = null,
              updated_at = now()
        where id = $1`,
      [id, await hashPassword(password), opts.mustChange ?? false],
    );
    if (rowCount === 0) throw new UnknownUserError(id);
  }

  async setRole(id: string, role: string): Promise<User> {
    UsersRepository.assertRole(role);
    const { rows } = await this.pool.query<Row>(
      `update users set role = $2, updated_at = now() where id = $1 returning ${COLUMNS}`,
      [id, role],
    );
    if (rows.length === 0) throw new UnknownUserError(id);
    return toUser(rows[0]);
  }

  /** Disabled, never deleted — a user who signed something still has to be nameable. */
  async setDisabled(id: string, disabled: boolean): Promise<User> {
    const { rows } = await this.pool.query<Row>(
      `update users set disabled_at = case when $2 then now() else null end, updated_at = now()
        where id = $1 returning ${COLUMNS}`,
      [id, disabled],
    );
    if (rows.length === 0) throw new UnknownUserError(id);
    return toUser(rows[0]);
  }

  /** Clears a lockout without changing the password. */
  async unlock(id: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      'update users set failed_attempts = 0, locked_until = null, updated_at = now() where id = $1',
      [id],
    );
    if (rowCount === 0) throw new UnknownUserError(id);
  }
}
