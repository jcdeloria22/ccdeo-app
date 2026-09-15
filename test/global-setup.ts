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
 */
import { Client } from 'pg';
import path from 'node:path';
import { loadDotenv } from '../src/config/load-dotenv';
import { databaseName, maintenanceUrl, resolveTestUrl } from './test-database';

export default async function setup(): Promise<void> {
  loadDotenv(path.join(__dirname, '..', '.env'));
  const dev = process.env.DATABASE_URL;
  if (!dev) return;

  const url = resolveTestUrl(dev, process.env.TEST_DATABASE_URL);
  const name = databaseName(url);

  const admin = new Client({ connectionString: maintenanceUrl(url) });
  await admin.connect();
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
