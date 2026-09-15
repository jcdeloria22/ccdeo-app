/**
 * Migration runner.
 *
 * Numbered SQL files applied in order, each recorded so it runs once. Plain SQL
 * rather than an ORM's migration DSL: the schema here has constraints, generated
 * columns and grants that matter more than portability, and they should be
 * readable as SQL.
 *
 * Each file runs inside a transaction, so a failure leaves nothing half-applied.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';
import { loadDotenv } from '../config/load-dotenv';
import { loadEnv } from '../config/env';
import { createPool } from './pool';

const DIR = path.join(__dirname, '..', '..', 'migrations');

export async function ensureMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(`
    create table if not exists applied_migrations (
      filename    text primary key,
      applied_at  timestamptz not null default now(),
      sha256      text not null
    )`);
}

async function sha256(text: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export interface MigrationResult {
  readonly applied: string[];
  readonly skipped: string[];
}

export async function migrate(pool: Pool, dir: string = DIR): Promise<MigrationResult> {
  await ensureMigrationsTable(pool);

  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await pool.query<{ filename: string; sha256: string }>(
    'select filename, sha256 from applied_migrations',
  );
  const seen = new Map(rows.map((r) => [r.filename, r.sha256]));

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const sql = await readFile(path.join(dir, file), 'utf8');
    const hash = await sha256(sql);
    const prior = seen.get(file);

    if (prior) {
      // A migration that changed after being applied is a mistake worth shouting
      // about: the database and the file no longer agree.
      if (prior !== hash) {
        throw new Error(
          `Migration ${file} has changed since it was applied.\n` +
            'Migrations are immutable once run — add a new one instead of editing this.',
        );
      }
      skipped.push(file);
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into applied_migrations (filename, sha256) values ($1, $2)', [file, hash]);
      await client.query('commit');
      applied.push(file);
    } catch (err) {
      await client.query('rollback');
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  return { applied, skipped };
}

if (require.main === module) {
  (async () => {
    loadDotenv();
  const env = loadEnv();
    const pool = createPool(env);
    try {
      const r = await migrate(pool);
      // eslint-disable-next-line no-console
      console.log(
        r.applied.length ? `applied:\n  ${r.applied.join('\n  ')}` : 'nothing to apply',
        `\n${r.skipped.length} already applied`,
      );
    } finally {
      await pool.end();
    }
  })().catch((e: unknown) => {
    // eslint-disable-next-line no-console
    console.error(`\n${(e as Error).message}\n`);
    process.exit(1);
  });
}
