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

export function createPool(env: Pick<Env, 'DATABASE_URL'>): Pool {
  if (!env.DATABASE_URL) throw new DatabaseNotConfiguredError();
  return new Pool({ connectionString: env.DATABASE_URL, max: 10 });
}

export function getPool(env: Pick<Env, 'DATABASE_URL'>): Pool {
  if (!pool) pool = createPool(env);
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) { await pool.end(); pool = null; }
}
