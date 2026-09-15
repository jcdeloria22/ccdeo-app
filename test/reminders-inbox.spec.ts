/**
 * The reminders space.
 *
 * Reminders are delivered to an in-app inbox rather than to email — decided
 * 15 September 2026 — so the things worth proving are that the inbox shows what
 * needs attention first, and that reading is per person and recorded rather than
 * edited in place.
 *
 * The routes' own guard declarations are covered for every controller at once in
 * routes.spec.ts, rather than here for this one.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { migrate } from '../src/db/migrate';
import { ProjectsRepository } from '../src/projects/projects.repository';
import { SlotsRepository } from '../src/slots/slots.repository';
import { UploadsRepository } from '../src/uploads/uploads.repository';
import { FilesystemStorage } from '../src/storage/filesystem.storage';
import { DocumentsRepository } from '../src/lifecycle/documents.repository';
import { AgeingRepository } from '../src/ageing/ageing.repository';
import { InboxRepository } from '../src/reminders/inbox.repository';
import type { Role } from '../src/policy/roles';
import type { Scanner } from '../src/scan/scanner';

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;

const as = (role: Role, id = 'operator:single') => ({
  id,
  name: 'Jayz',
  email: 'jayz@example.com',
  role,
  authMode: 'password' as const,
});

const cleanScanner: Scanner = {
  name: 'fake',
  available: async () => true,
  scan: async () => ({ verdict: 'clean' as const, detail: null, scanner: 'fake', scannedAt: new Date() }),
};

run('the reminder inbox', () => {
  let pool: Pool;
  let dir: string;
  let inbox: InboxRepository;
  let ageing: AgeingRepository;
  let docs: DocumentsRepository;
  let uploads: UploadsRepository;
  let projectId: string;

  const SLOT = 'qcp';
  const me = as('admin');
  const someoneElse = as('approver', 'operator:second');

  /** A Final document whose clock is backdated, so a reminder is due for it. */
  const agedFinal = async (body: string, daysAgo: number) => {
    const u = await uploads.upload(
      { projectId, slotCode: SLOT, filename: 'qcp.pdf', bytes: Buffer.from(body) },
      as('admin'),
    );
    await uploads.scan(u.id);
    const d = await docs.create({ projectId, slotCode: SLOT, title: 'QCP', uploadId: u.id }, as('materials_engineer'));
    const final = await docs.transition(d.id, 'Final', as('materials_engineer'));
    await pool.query("update documents set state_since = now() - ($2 || ' days')::interval where id = $1", [
      final.id,
      String(daysAgo),
    ]);
    return final.id;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await migrate(pool);
    await pool.query('truncate table reminder_acknowledgements, reminders cascade');
    await pool.query('truncate table documents, approvals, document_transitions cascade');
    await pool.query('truncate table uploads, project_slots cascade');
    await pool.query("delete from projects where contract_id like '26IN%'");
    await pool.query("delete from slot_templates where code = 'in-set'");

    dir = await mkdtemp(path.join(os.tmpdir(), 'dpwh-in-'));
    const storage = new FilesystemStorage(dir);
    const slots = new SlotsRepository(pool);
    uploads = new UploadsRepository(pool, storage, cleanScanner);
    docs = new DocumentsRepository(pool);
    ageing = new AgeingRepository(pool);
    inbox = new InboxRepository(pool);

    const t = await slots.createVersion(
      { code: 'in-set', name: 'Inbox fixture', items: [{ slotCode: SLOT, name: 'QCP', required: true }] },
      as('admin'),
    );
    await slots.publish(t.id);
    projectId = (await new ProjectsRepository(pool).create(
      { contractId: '26IN0001', name: 'Inbox fixture' },
      as('admin'),
    )).id;
    await slots.instantiate(projectId, 'in-set');
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('is empty before anything is raised', async () => {
    expect(await inbox.list(me)).toEqual([]);
    expect(await inbox.counts(me)).toEqual({ unread: 0, unreadOverdue: 0, unreadWarning: 0, total: 0 });
  });

  it('carries a raised reminder, unread, with the project it belongs to', async () => {
    await agedFinal('v1', 20);
    await ageing.run(new Date(), me, projectId);

    const items = await inbox.list(me);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      level: 'overdue',
      state: 'Final',
      slotCode: SLOT,
      contractId: '26IN0001',
      acknowledgedAt: null,
      acknowledgedBy: null,
    });
    expect(items[0].ageDays).toBeGreaterThan(19);
    expect(items[0].reason).toContain('Final');
  });

  it('counts what is unread, split by severity — the number on the tab', async () => {
    const c = await inbox.counts(me);
    expect(c).toMatchObject({ unread: 1, unreadOverdue: 1, unreadWarning: 0, total: 1 });
  });

  it('puts the most severe unread item first', async () => {
    await agedFinal('v2', 4); // warning, not overdue
    await ageing.run(new Date(), me, projectId);

    const items = await inbox.list(me);
    expect(items).toHaveLength(2);
    expect(items[0].level).toBe('overdue');
    expect(items[1].level).toBe('warning');
    expect(await inbox.counts(me)).toMatchObject({ unread: 2, unreadOverdue: 1, unreadWarning: 1 });
  });

  it('marks one read, and says it was the call that did it', async () => {
    const first = (await inbox.list(me))[0];
    expect(await inbox.acknowledge(me, first.reminderId)).toBe(true);

    const after = await inbox.find(me, first.reminderId);
    expect(after!.acknowledgedAt).toBeInstanceOf(Date);
    expect(after!.acknowledgedBy).toBe(me.id);
    expect(await inbox.counts(me)).toMatchObject({ unread: 1, unreadOverdue: 0 });
  });

  it('treats a second click as the same fact, not a new one', async () => {
    const read = (await inbox.list(me)).find((i) => i.acknowledgedAt !== null)!;
    expect(await inbox.acknowledge(me, read.reminderId)).toBe(false);

    const { rows } = await pool.query<{ n: string }>(
      'select count(*) as n from reminder_acknowledgements where reminder_id = $1',
      [read.reminderId],
    );
    expect(Number(rows[0].n)).toBe(1);
  });

  it('sorts unread above read, however old', async () => {
    const items = await inbox.list(me);
    expect(items[0].acknowledgedAt).toBeNull();
    expect(items[items.length - 1].acknowledgedAt).not.toBeNull();
  });

  it('filters to unread on request', async () => {
    const unread = await inbox.list(me, { unreadOnly: true });
    expect(unread).toHaveLength(1);
    expect(unread.every((i) => i.acknowledgedAt === null)).toBe(true);
  });

  /**
   * Reading is per person. With one operator this is a distinction without a
   * difference; the moment a second person has an account it stops being one, and
   * the other design would let one person's click clear everyone's inbox.
   */
  it('does not clear anyone else inbox when one person reads', async () => {
    expect((await inbox.counts(someoneElse)).unread).toBe(2);
    expect((await inbox.counts(me)).unread).toBe(1);

    const theirs = await inbox.list(someoneElse);
    expect(theirs.every((i) => i.acknowledgedAt === null)).toBe(true);
  });

  it('clears the tab, and reports only what was newly marked', async () => {
    expect(await inbox.acknowledgeAll(me, projectId)).toBe(1); // the other was already read
    expect(await inbox.counts(me)).toMatchObject({ unread: 0, unreadOverdue: 0, unreadWarning: 0, total: 2 });

    expect(await inbox.acknowledgeAll(me, projectId)).toBe(0);
  });

  it('leaves the other person still holding everything', async () => {
    expect((await inbox.counts(someoneElse)).unread).toBe(2);
  });

  it('scopes to a project when asked', async () => {
    const other = (await new ProjectsRepository(pool).create(
      { contractId: '26IN0002', name: 'Another project' },
      as('admin'),
    )).id;
    expect(await inbox.list(me, { projectId: other })).toEqual([]);
    expect(await inbox.counts(me, other)).toMatchObject({ total: 0, unread: 0 });
  });

  it('keeps the acknowledgement record append-only', async () => {
    await expect(pool.query("update reminder_acknowledgements set actor_id = 'someone else'")).rejects.toThrow(
      /append-only/i,
    );
  });

  it('returns nothing for a reminder that does not exist', async () => {
    expect(await inbox.find(me, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('honours a limit', async () => {
    expect(await inbox.list(me, { limit: 1 })).toHaveLength(1);
  });
});
