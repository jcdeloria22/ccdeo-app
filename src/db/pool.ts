/**
 * The database pool.
 *
 * One pool for the process, created from the validated config. Nothing else
 * constructs a connection, for the same reason nothing else reads process.env.
 */
import { Pool } from 'pg';
import type { Env } from '../config/env';

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super('DATABASE_URL is not set — required from DC-02 onwards');
    this.name = 'DatabaseNotConfiguredError';
  }
}

let pool: Pool | null = null;

/**
 * TLS settings for the driver.
 *
 * `no-verify` is deliberately spelled out rather than hidden behind a boolean:
 * it encrypts the connection but accepts any certificate, so it defends against
 * someone listening and not against someone in the middle. A reader should not
 * have to infer that from `ssl: true`.
 */
function sslFor(mode: Env['DATABASE_SSL']): false | { rejectUnauthorized: boolean } {
  if (mode === 'off') return false;
  return { rejectUnauthorized: mode === 'require' };
}

export function createPool(env: Pick<Env, 'DATABASE_URL' | 'DATABASE_SSL'>): Pool {
  if (!env.DATABASE_URL) throw new DatabaseNotConfiguredError();
  return new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    ssl: sslFor(env.DATABASE_SSL ?? 'off'),
    /*
     * A hosted database is across a network and can simply stop answering. With
     * no timeout the pool waits forever and the request hangs with it; a refusal
     * the caller can report beats a page that never loads.
     */
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
}

export function getPool(env: Pick<Env, 'DATABASE_URL' | 'DATABASE_SSL'>): Pool {
  if (!pool) pool = createPool(env);
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) { await pool.end(); pool = null; }
}
