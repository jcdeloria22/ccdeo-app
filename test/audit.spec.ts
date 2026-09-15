/**
 * DC-04 — the audit trail must be genuinely append-only, not append-only by
 * convention. These tests connect as the *application* role, which is the one
 * that matters: it is the role a bug would be running as.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { migrate } from '../src/db/migrate';
import { AuditRepository, canonical, hashEvent } from '../src/audit/audit.repository';
import { seededOperator } from '../src/operator/operator';
import { loadEnv } from '../src/config/env';

const superUrl = process.env.DATABASE_URL;
/** Same cluster and database, connected as the restricted application role. */
const appUrl = superUrl ? superUrl.replace(/\/\/[^@]*@/, '//dpwh_app@') : undefined;

const run = superUrl ? describe : describe.skip;

const actor = (role: 'admin' | 'materials_engineer' = 'admin') =>
  seededOperator(
    loadEnv({ AUTH_MODE: 'none', OPERATOR_NAME: 'Jayz', OPERATOR_EMAIL: 'jayz@example.com' } as NodeJS.ProcessEnv),
    role,
  );

run('DC-04 audit', () => {
  let admin: Pool;
  let app: Pool;
  let repo: AuditRepository;

  beforeAll(async () => {
    admin = new Pool({ connectionString: superUrl });
    await migrate(admin);
    await admin.query('truncate table audit_events restart identity');
    app = new Pool({ connectionString: appUrl });
    repo = new AuditRepository(app);
  }, 60_000);

  afterAll(async () => {
    if (app) await app.end();
    if (admin) await admin.end();
  });

  it('appends an event and records who acted and under which role', async () => {
    const e = await repo.append({ action: 'project.created', subjectType: 'project', subjectId: 'p1' }, actor('materials_engineer'));
    expect(e.actorId).toBe('operator:single');
    expect(e.actorRole).toBe('materials_engineer');
    expect(e.prevHash).toBeNull();
    expect(e.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('chains each event to the one before it', async () => {
    const a = await repo.append({ action: 'project.updated', subjectType: 'project', subjectId: 'p1' }, actor());
    const b = await repo.append({ action: 'project.updated', subjectType: 'project', subjectId: 'p1' }, actor());
    expect(a.prevHash).not.toBeNull();
    expect(b.prevHash).toBe(a.hash);
  });

  it('verifies the whole chain', async () => {
    const v = await repo.verifyChain();
    expect(v.ok).toBe(true);
    expect(v.checked).toBe(3);
  });

  it('REFUSES an update from the application role', async () => {
    await expect(app.query("update audit_events set action = 'tampered' where id = 1")).rejects.toThrow();
  });

  it('REFUSES a delete from the application role', async () => {
    await expect(app.query('delete from audit_events where id = 1')).rejects.toThrow();
  });

  it('refuses an update even as the owner — the trigger, not just the grant', async () => {
    await expect(admin.query("update audit_events set action = 'tampered' where id = 1")).rejects.toThrow(
      /append-only/i,
    );
  });

  it('detects tampering that got past both, by content', async () => {
    // Simulate a restored dump or direct edit: disable the trigger as owner.
    await admin.query('alter table audit_events disable trigger audit_events_no_update');
    try {
      await admin.query("update audit_events set action = 'quietly changed' where id = 2");
      const v = await repo.verifyChain();
      expect(v.ok).toBe(false);
      expect(v.brokenAt).toBe('2');
      expect(v.reason).toMatch(/does not match its hash/);
    } finally {
      await admin.query("update audit_events set action = 'project.updated' where id = 2");
      await admin.query('alter table audit_events enable trigger audit_events_no_update');
    }
  });

  it('is whole again once the tampering is reverted', async () => {
    const v = await repo.verifyChain();
    expect(v.ok).toBe(true);
  });

  it('keeps a document\'s events after the document itself is gone', async () => {
    // subject_id is plain text with no foreign key, precisely so this holds.
    // This creates and removes only its OWN row: deleting every project would
    // destroy rows another spec file owns, and the failure would show up over
    // there looking like a real bug.
    const { rows } = await admin.query<{ id: string }>(
      `insert into projects (contract_id, name, created_by, created_by_role)
       values ('26ZZ9001', 'audit isolation fixture', 'operator:single', 'admin')
       returning id`,
    );
    const id = rows[0].id;
    await repo.append({ action: 'project.created', subjectType: 'project', subjectId: id }, actor());
    const before = (await repo.forSubject('project', id)).length;
    expect(before).toBe(1);

    await admin.query('delete from projects where id = $1', [id]);
    expect((await repo.forSubject('project', id)).length).toBe(before);
  });

  it('serialises concurrent appends into one unbroken chain', async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        repo.append({ action: 'concurrent', subjectType: 'test', subjectId: String(i) }, actor()),
      ),
    );
    const v = await repo.verifyChain();
    expect(v.ok).toBe(true);
  }, 30_000);
  /**
   * The trail is read to answer "what just happened", so the page has to be the
   * most recent events. `order by id limit n` reads like the right query and is
   * the exact opposite: it returns the OLDEST n, so once the trail passed the
   * limit the audit screen showed the system's first 200 events forever and
   * nothing that had happened since. Nothing covered this, which is why it stood.
   */
  describe('listing', () => {
    it('returns the most recent events, not the first ones ever recorded', async () => {
      for (let i = 0; i < 12; i++) {
        await repo.append({ action: 'project.updated', subjectType: 'project', subjectId: `list-${i}` }, actor());
      }

      const page = await repo.list(5);
      expect(page).toHaveLength(5);

      const subjects = page.map((e) => e.subjectId);
      expect(subjects, 'the newest five, not the oldest five').toEqual([
        'list-7',
        'list-8',
        'list-9',
        'list-10',
        'list-11',
      ]);
    });

    /** Ascending, because the hash chain only reads in that direction. */
    it('returns them oldest first within the page', async () => {
      const page = await repo.list(4);
      // `id` is a bigint serialised as a string, so compare numerically — a
      // string sort puts "10" before "9".
      const ids = page.map((e) => Number(e.id));
      expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    });

    it('returns everything when the limit is larger than the trail', async () => {
      const all = await repo.list(10_000);
      const everything = await repo.forSubject('project', 'list-11');
      expect(all.length).toBeGreaterThanOrEqual(everything.length);
      expect(all[all.length - 1].subjectId).toBe('list-11');
    });

});

describe('canonical hashing', () => {
  it('does not depend on key order', () => {
    expect(canonical({ b: 1, a: 2 })).toBe(canonical({ a: 2, b: 1 }));
  });

  it('sorts nested keys too', () => {
    expect(canonical({ x: { b: 1, a: 2 } })).toBe(canonical({ x: { a: 2, b: 1 } }));
  });

  it('distinguishes values that merely look similar', () => {
    expect(canonical({ a: 1 })).not.toBe(canonical({ a: '1' }));
    expect(canonical([1, 2])).not.toBe(canonical([2, 1]));
  });

  it('changes the hash when any field changes', () => {
    const base = {
      prevHash: null, occurredAt: '2026-09-15T00:00:00.000Z',
      actorId: 'a', actorRole: 'admin', action: 'x',
      subjectType: 'project', subjectId: 'p', detail: {},
    };
    const h = hashEvent(base);
    expect(hashEvent({ ...base, action: 'y' })).not.toBe(h);
    expect(hashEvent({ ...base, actorRole: 'viewer' })).not.toBe(h);
    expect(hashEvent({ ...base, prevHash: 'abc' })).not.toBe(h);
    expect(hashEvent({ ...base, detail: { a: 1 } })).not.toBe(h);
  });
  });
});
