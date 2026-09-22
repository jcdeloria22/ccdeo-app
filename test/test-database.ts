/**
 * Which database the suite is allowed to run against.
 *
 * The specs call `truncate` on projects, documents, approvals, uploads,
 * reminders, settings, slot templates and the audit trail — they have to, since
 * they assert exact counts and a hash chain that has to start somewhere. Pointed
 * at the development database that also serves the running app, a test run
 * silently destroyed whatever had been set up by hand.
 *
 * So the suite runs against a database whose name ends in `_test`, derived from
 * the development one. The rules live here, as pure functions, so the guard can
 * be tested rather than trusted.
 */

import path from 'node:path';

export const TEST_SUFFIX = '_test';

/**
 * Where `global-setup.ts` records that the database could not be reached.
 *
 * A file rather than an environment variable because the global setup runs in
 * its own process and cannot alter what the workers inherit. It lives under
 * `node_modules` so it is already ignored by git and cleared by a clean install,
 * and it is removed at the start of every run so a stale one cannot make a
 * later run skip silently.
 */
export const UNREACHABLE_MARKER = path.join(__dirname, '..', 'node_modules', '.cache', 'vitest-no-database');

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

/** The development URL with `_test` appended to the database name. */
export function deriveTestUrl(devUrl: string): string {
  const url = new URL(devUrl);
  const name = databaseName(devUrl);
  if (!name) throw new Error(`DATABASE_URL names no database: ${devUrl}`);
  url.pathname = `/${name}${name.endsWith(TEST_SUFFIX) ? '' : TEST_SUFFIX}`;
  return url.toString();
}

/** The maintenance database on the same cluster, for `create database`. */
export function maintenanceUrl(url: string): string {
  const u = new URL(url);
  u.pathname = '/postgres';
  return u.toString();
}

export class UnsafeTestDatabaseError extends Error {
  constructor(name: string, derived: string) {
    super(
      `Refusing to run the suite against "${name}". These tests truncate tables, so the ` +
        `database name must end in "${TEST_SUFFIX}". Unset TEST_DATABASE_URL to use the ` +
        `derived "${derived}", or point it at a database of your own.`,
    );
    this.name = 'UnsafeTestDatabaseError';
  }
}

/**
 * The URL the suite may use, or a throw.
 *
 * This is the guard the whole arrangement exists for: a test suite must not be
 * one typo away from deleting the data it is meant to protect.
 */
export function resolveTestUrl(devUrl: string, override?: string): string {
  const url = override ?? deriveTestUrl(devUrl);
  const name = databaseName(url);
  if (!name.endsWith(TEST_SUFFIX)) throw new UnsafeTestDatabaseError(name, databaseName(deriveTestUrl(devUrl)));
  return url;
}
