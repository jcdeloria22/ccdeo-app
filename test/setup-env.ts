/**
 * Load .env for tests, and point them at a database of their own.
 *
 * Without the dotenv load, a clean shell runs `npm test`, `DATABASE_URL` is
 * unset, and every database spec SKIPS — reporting a green run that proved none
 * of the things those specs exist to prove. A silent skip is worse than a
 * failure. Real environment variables always win, so CI can override.
 *
 * The redirect below sends the suite to a `_test` database instead of the one
 * serving the running app, because these specs truncate. Every spec reads
 * `process.env.DATABASE_URL`, so doing it here redirects all of them and no spec
 * had to change. The database itself is created in `test/global-setup.ts`; the
 * rules and the guard are in `test/test-database.ts`.
 */
import path from 'node:path';
import { loadDotenv } from '../src/config/load-dotenv';
import { resolveTestUrl } from './test-database';

loadDotenv(path.join(__dirname, '..', '.env'));

if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = resolveTestUrl(process.env.DATABASE_URL, process.env.TEST_DATABASE_URL);
}
