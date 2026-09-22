/**
 * Create the test database once, before any suite runs.
 *
 * Here rather than in `setup-env.ts` because that file runs in every worker and
 * must stay synchronous — the backend tsconfig does not allow top-level await.
 * Creating a database is also exactly the kind of thing that should happen once.
 *
 * Nothing is dropped at the end. A suite that truncates what it needs leaves the
 * database reusable, and keeping it means the next run does not pay to rebuild
 * it — while the development database, which is the one that matters, is never
 * touched at all.
 *
 * **An unreachable database must not cancel the whole run.** The first version
 * of this file let the connection error escape, and vitest answered by aborting
 * before collection and reporting `no tests` — not a failure, not a skip, just
 * an empty run that reads as success at a glance. With the local cluster down
 * that silently hid every one of the ~200 tests that need no database at all.
 *
 * So a database that cannot be reached is caught, announced loudly, and recorded
 * in a marker file that `setup-env.ts` reads synchronously in each worker. The
 * database specs then skip the way they already do when `DATABASE_URL` is unset,
 * and everything else runs.
 */
import { Client } from 'pg';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadDotenv } from '../src/config/load-dotenv';
import { databaseName, maintenanceUrl, resolveTestUrl, UNREACHABLE_MARKER } from './test-database';

/** Anything that means "the server is not there", as opposed to "it refused us". */
function isUnreachable(e: unknown): boolean {
  const code = (e as { code?: string }).code;
  return (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'EHOSTUNREACH' ||
    code === 'ECONNRESET'
  );
}

function markUnreachable(why: string): void {
  mkdirSync(path.dirname(UNREACHABLE_MARKER), { recursive: true });
  writeFileSync(UNREACHABLE_MARKER, why, 'utf8');

  console.warn(
    [
      '',
      '  ┌─────────────────────────────────────────────────────────────────┐',
      '  │  No database — the database specs will SKIP.                    │',
      '  └─────────────────────────────────────────────────────────────────┘',
      `  ${why}`,
      '',
      '  Everything that does not need a database still runs. To run the rest:',
      '',
      '      bash scripts/pg-local.sh start',
      '',
      '  (After an unclean shutdown the first start replays the write-ahead log',
      '   and can take a minute. That is recovery, not a hang.)',
      '',
    ].join('\n'),
  );
}

export default async function setup(): Promise<void> {
  loadDotenv(path.join(__dirname, '..', '.env'));

  // Stale marker from a previous run must never make this one skip silently.
  rmSync(UNREACHABLE_MARKER, { force: true });

  const dev = process.env.DATABASE_URL;
  if (!dev) return;

  const url = resolveTestUrl(dev, process.env.TEST_DATABASE_URL);
  const name = databaseName(url);

  const admin = new Client({ connectionString: maintenanceUrl(url), connectionTimeoutMillis: 10_000 });

  try {
    await admin.connect();
  } catch (e) {
    /*
     * Unreachable is a fact about the machine, not about the code, so it is
     * reported and the run continues. Anything else — bad credentials, a
     * refused database — is a real misconfiguration and still throws.
     */
    if (isUnreachable(e)) {
      markUnreachable(`${(e as Error).message} (tried ${maintenanceUrl(url)})`);
      return;
    }
    throw e;
  }

  try {
    const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [name]);
    // `create database` takes no parameters and cannot run in a transaction. The
    // name comes from the operator's own DATABASE_URL, never from input, and the
    // identifier is quoted.
    if (rowCount === 0) {
      await admin.query(`create database "${name.replace(/"/g, '""')}"`);
      console.log(`created test database ${name}`);
    }
  } finally {
    await admin.end();
  }
}
