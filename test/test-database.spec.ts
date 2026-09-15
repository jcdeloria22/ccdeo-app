/**
 * The guard that decides which database the suite may truncate.
 *
 * This is the one piece of test infrastructure that is itself worth testing. The
 * specs truncate projects, documents, approvals, uploads, reminders, settings,
 * slot templates and the audit trail; for a long time they did it to the
 * development database that was also serving the running app, and a test run
 * silently destroyed hand-made contracts, uploaded documents, the Builder's
 * saved signatories and the audit trail itself.
 *
 * A wrong answer here brings that back, so the rules are pure functions and
 * these are the tests for them.
 */
import { describe, it, expect } from 'vitest';
import {
  databaseName,
  deriveTestUrl,
  maintenanceUrl,
  resolveTestUrl,
  TEST_SUFFIX,
  UnsafeTestDatabaseError,
} from './test-database';

const DEV = 'postgres://postgres@127.0.0.1:5433/dpwh_doc_control';

describe('naming the test database', () => {
  it('appends the suffix to the development name', () => {
    expect(deriveTestUrl(DEV)).toBe('postgres://postgres@127.0.0.1:5433/dpwh_doc_control_test');
  });

  it('does not append it twice to a name that already has it', () => {
    const once = deriveTestUrl(DEV);
    expect(deriveTestUrl(once)).toBe(once);
  });

  it('keeps the host, port and user of the development cluster', () => {
    const url = new URL(deriveTestUrl('postgres://someone:pw@db.internal:6000/app'));
    expect(url.host).toBe('db.internal:6000');
    expect(url.username).toBe('someone');
    expect(url.pathname).toBe('/app_test');
  });

  it('refuses a URL that names no database', () => {
    expect(() => deriveTestUrl('postgres://postgres@127.0.0.1:5433/')).toThrow(/names no database/);
  });

  it('points create-database at the maintenance database on the same cluster', () => {
    expect(maintenanceUrl(DEV)).toBe('postgres://postgres@127.0.0.1:5433/postgres');
  });
});

describe('the guard', () => {
  it('allows the derived database', () => {
    expect(databaseName(resolveTestUrl(DEV))).toBe('dpwh_doc_control_test');
  });

  it('allows an override that ends in the suffix', () => {
    const mine = 'postgres://postgres@127.0.0.1:5433/scratch_test';
    expect(resolveTestUrl(DEV, mine)).toBe(mine);
  });

  /**
   * The whole point. An override pointing at the working database must abort the
   * run, not truncate it — a suite must not be one typo away from deleting the
   * data it exists to protect.
   */
  it('refuses an override that points at the development database', () => {
    expect(() => resolveTestUrl(DEV, DEV)).toThrow(UnsafeTestDatabaseError);
  });

  it('refuses any name not ending in the suffix, however plausible', () => {
    for (const name of ['dpwh_doc_control', 'test', 'testing', 'dpwh_test_doc', 'prod']) {
      expect(() => resolveTestUrl(DEV, `postgres://postgres@127.0.0.1:5433/${name}`), name).toThrow(
        UnsafeTestDatabaseError,
      );
    }
  });

  it('says what to do about it rather than only refusing', () => {
    try {
      resolveTestUrl(DEV, DEV);
      expect.unreachable('should have thrown');
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toMatch(/truncate/);
      expect(message).toMatch(new RegExp(TEST_SUFFIX));
      expect(message, 'names the derived database it would have used').toMatch(/dpwh_doc_control_test/);
    }
  });

  /** The suffix is the contract; a change to it is a change to the guard. */
  it('uses the suffix the README documents', () => {
    expect(TEST_SUFFIX).toBe('_test');
  });
});

describe('what the suite is actually connected to', () => {
  /**
   * Belt and braces: whatever the reasoning above, the live value in this process
   * must be a test database. If this ever fails, something redirected the suite
   * back at the working data.
   */
  it('is a _test database, or none at all', () => {
    const live = process.env.DATABASE_URL;
    if (!live) return; // no database configured; the db specs skip
    expect(databaseName(live).endsWith(TEST_SUFFIX), `connected to ${databaseName(live)}`).toBe(true);
  });
});
