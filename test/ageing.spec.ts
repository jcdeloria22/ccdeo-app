/**
 * DC-10 — ageing and reminders.
 *
 * `now` is passed in everywhere, so every boundary here is stated outright rather
 * than depending on when the suite runs. The rules under test: the clock belongs
 * to the state and resets with it, terminal and finished work has no clock at
 * all, and the engine can be run on a schedule without ever saying the same thing
 * twice.
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
import { AgeingRepository, InboxSink, type ReminderSink } from '../src/ageing/ageing.repository';
import { ageInDays, assess, ageAll, remindersDue, summariseAgeing } from '../src/ageing/ageing';
import { DEFAULT_SLAS, hasClock, slaFor, type Sla } from '../src/ageing/sla';
import { STATES, TERMINAL } from '../src/lifecycle/states';
import type { Reminder } from '../src/ageing/ageing';
import type { Role } from '../src/policy/roles';
import type { Scanner } from '../src/scan/scanner';

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;

const as = (role: Role) => ({
  id: 'operator:single',
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

const T0 = new Date('2026-09-01T00:00:00.000Z');
const daysAfter = (n: number) => new Date(T0.getTime() + n * 86_400_000);

const item = (over: Partial<Parameters<typeof ageAll>[0][number]> = {}) => ({
  documentId: 'doc-1',
  projectId: 'proj-1',
  contractId: '26XX0001',
  slotCode: 'qcp',
  title: 'QCP',
  state: 'Final' as const,
  stateSince: T0,
  ...over,
});

describe('the SLA table', () => {
  it('runs no clock on finished or terminal work', () => {
    expect(hasClock('Signed')).toBe(false);
    for (const s of TERMINAL) expect(hasClock(s)).toBe(false);
  });

  it('runs a clock on every state where something is still owed', () => {
    for (const s of ['Draft', 'In Review', 'Final'] as const) expect(hasClock(s)).toBe(true);
  });

  it('names only states the lifecycle knows', () => {
    for (const s of DEFAULT_SLAS) expect(STATES).toContain(s.state);
  });

  it('warns before it escalates', () => {
    for (const s of DEFAULT_SLAS) expect(s.warnAfterDays).toBeLessThan(s.overdueAfterDays);
  });

  it('keeps the tightest clock on approval debt — the backlog the product exists to drain', () => {
    const final = slaFor('Final')!;
    for (const s of DEFAULT_SLAS.filter((x) => x.state !== 'Final')) {
      expect(final.overdueAfterDays).toBeLessThan(s.overdueAfterDays);
    }
  });

  it('is confirmed, not provisional — the owner settled these on 15 Sep 2026', () => {
    for (const s of DEFAULT_SLAS) expect(s.provisional).toBe(false);
  });

  it('counts calendar days on every row, as confirmed', () => {
    for (const s of DEFAULT_SLAS) expect(s.basis).toBe('calendar');
  });
});

describe('age', () => {
  it('is measured from the transition timestamp', () => {
    expect(ageInDays(T0, daysAfter(3))).toBe(3);
    expect(ageInDays(T0, new Date(T0.getTime() + 43_200_000))).toBe(0.5);
  });

  it('is never negative, however odd the row', () => {
    expect(ageInDays(daysAfter(5), T0)).toBe(0);
  });

  it('turns amber exactly at the warning threshold, not a moment before', () => {
    const sla = slaFor('Final')!;
    const justBefore = new Date(T0.getTime() + sla.warnAfterDays * 86_400_000 - 1);
    expect(assess('Final', T0, justBefore).severity).toBe('ok');
    expect(assess('Final', T0, daysAfter(sla.warnAfterDays)).severity).toBe('warning');
  });

  it('turns red exactly at the overdue threshold', () => {
    const sla = slaFor('Final')!;
    const justBefore = new Date(T0.getTime() + sla.overdueAfterDays * 86_400_000 - 1);
    expect(assess('Final', T0, justBefore).severity).toBe('warning');
    expect(assess('Final', T0, daysAfter(sla.overdueAfterDays)).severity).toBe('overdue');
  });

  it('reports no severity where no clock runs, however old', () => {
    const a = assess('Signed', T0, daysAfter(400));
    expect(a.severity).toBe('none');
    expect(a.sla).toBeNull();
    expect(a.daysUntilOverdue).toBeNull();
    expect(a.ageDays).toBe(400);
  });

  it('never counts down past zero', () => {
    const a = assess('Final', T0, daysAfter(99));
    expect(a.daysUntilWarning).toBe(0);
    expect(a.daysUntilOverdue).toBe(0);
  });

  it('puts the oldest first', () => {
    const aged = ageAll(
      [
        item({ documentId: 'young', stateSince: daysAfter(9) }),
        item({ documentId: 'old', stateSince: T0 }),
        item({ documentId: 'middling', stateSince: daysAfter(4) }),
      ],
      daysAfter(10),
    );
    expect(aged.map((a) => a.documentId)).toEqual(['old', 'middling', 'young']);
  });

  it('summarises by severity and names the oldest tracked item', () => {
    const aged = ageAll(
      [
        item({ documentId: 'overdue', stateSince: T0 }),
        item({ documentId: 'warning', stateSince: daysAfter(6) }),
        item({ documentId: 'fine', stateSince: daysAfter(9) }),
        item({ documentId: 'done', state: 'Signed', stateSince: T0 }),
      ],
      daysAfter(10),
    );
    const s = summariseAgeing(aged);
    expect(s).toMatchObject({ overdue: 1, warning: 1, ok: 1, untracked: 1 });
    expect(s.oldest!.documentId).toBe('overdue');
  });

  it('has no oldest when nothing is tracked', () => {
    const aged = ageAll([item({ state: 'Signed' })], daysAfter(30));
    expect(summariseAgeing(aged).oldest).toBeNull();
  });
});

describe('what is due', () => {
  it('raises nothing while everything is inside its clock', () => {
    expect(remindersDue([item()], daysAfter(1))).toEqual([]);
  });

  it('raises the warning once the warning threshold is passed', () => {
    const due = remindersDue([item()], daysAfter(4));
    expect(due).toHaveLength(1);
    expect(due[0].level).toBe('warning');
  });

  it('raises only the escalation once it is overdue — not the warning as well', () => {
    const due = remindersDue([item()], daysAfter(30));
    expect(due.map((d) => d.level)).toEqual(['overdue']);
  });

  it('raises nothing for finished or terminal work, however old', () => {
    const settled = (['Signed', ...TERMINAL] as const).map((state, i) =>
      item({ documentId: `d${i}`, state, stateSince: T0 }),
    );
    expect(remindersDue(settled, daysAfter(365))).toEqual([]);
  });

  it('carries the clock it was raised against, so a re-entered state re-arms', () => {
    const first = remindersDue([item()], daysAfter(30))[0];
    const second = remindersDue([item({ stateSince: daysAfter(20) })], daysAfter(50))[0];
    expect(first.stateSince).not.toEqual(second.stateSince);
  });

  it('honours an overriding SLA table rather than the provisional defaults', () => {
    const strict: Sla[] = [
      { state: 'Final', warnAfterDays: 0.5, overdueAfterDays: 1, basis: 'calendar', provisional: false, note: 'confirmed' },
    ];
    expect(remindersDue([item()], daysAfter(0.75), strict)[0].level).toBe('warning');
    expect(remindersDue([item({ state: 'Draft' })], daysAfter(365), strict)).toEqual([]);
  });
});

run('DC-10 against the database', () => {
  let pool: Pool;
  let dir: string;
  let docs: DocumentsRepository;
  let uploads: UploadsRepository;
  let ageing: AgeingRepository;
  let projectId: string;
  let delivered: Reminder[];

  const SLOT = 'qcp';

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await migrate(pool);
    await pool.query('truncate table reminders, documents, approvals, document_transitions cascade');
    await pool.query('truncate table uploads, project_slots cascade');
    await pool.query("delete from projects where contract_id like '26AG%'");
    await pool.query("delete from slot_templates where code = 'ag-set'");

    dir = await mkdtemp(path.join(os.tmpdir(), 'dpwh-ag-'));
    const storage = new FilesystemStorage(dir);
    const slots = new SlotsRepository(pool);
    uploads = new UploadsRepository(pool, storage, cleanScanner);
    docs = new DocumentsRepository(pool);

    delivered = [];
    const sink: ReminderSink = {
      name: 'collecting',
      deliver: async (r) => {
        delivered.push(r);
      },
    };
    ageing = new AgeingRepository(pool, DEFAULT_SLAS, sink);

    const t = await slots.createVersion(
      { code: 'ag-set', name: 'Ageing fixture', items: [{ slotCode: SLOT, name: 'QCP', required: true }] },
      as('admin'),
    );
    await slots.publish(t.id);
    projectId = (await new ProjectsRepository(pool).create(
      { contractId: '26AG0001', name: 'Ageing fixture' },
      as('admin'),
    )).id;
    await slots.instantiate(projectId, 'ag-set');
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  /** A Final document whose clock is backdated to `daysAgo`. */
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

  it('shows nothing overdue on an empty register', async () => {
    const panel = await ageing.panel(new Date(), projectId);
    expect(panel.items).toEqual([]);
    expect(panel.summary.oldest).toBeNull();
    expect(panel.provisionalSlas).toBe(false);
  });

  it('flags a panel running on unconfirmed numbers, when there are any', async () => {
    const unconfirmed = new AgeingRepository(pool, [
      { state: 'Final', warnAfterDays: 1, overdueAfterDays: 2, basis: 'calendar', provisional: true, note: 'draft' },
    ]);
    expect((await unconfirmed.panel(new Date(), projectId)).provisionalSlas).toBe(true);
  });

  it('ages a document from its transition, not its creation', async () => {
    const id = await agedFinal('v1', 20);
    const panel = await ageing.panel(new Date(), projectId);
    const row = panel.items.find((i) => i.documentId === id)!;
    expect(row.aged.ageDays).toBeGreaterThan(19.9);
    expect(row.aged.severity).toBe('overdue');
  });

  it('raises a reminder, records it, and delivers it to the sink', async () => {
    delivered.length = 0;
    const raised = await ageing.run(new Date(), as('admin'), projectId);
    expect(raised).toHaveLength(1);
    expect(raised[0].level).toBe('overdue');
    expect(delivered).toHaveLength(1);
    expect(await ageing.history(raised[0].documentId)).toHaveLength(1);
  });

  it('says nothing twice when run again on the same state of the world', async () => {
    delivered.length = 0;
    expect(await ageing.run(new Date(), as('admin'), projectId)).toEqual([]);
    expect(delivered).toEqual([]);
  });

  it('re-arms when the document enters the state afresh', async () => {
    const [{ id }] = (
      await pool.query<{ id: string }>("select id from documents where project_id = $1 and state = 'Final'", [projectId])
    ).rows;

    // rejected back to Draft, then finalized again: a new clock
    await docs.transition(id, 'Draft', as('approver'), { reason: 'Missing sieve analysis' });
    await docs.transition(id, 'Final', as('materials_engineer'));
    await pool.query("update documents set state_since = now() - interval '9 days' where id = $1", [id]);

    const raised = await ageing.run(new Date(), as('admin'), projectId);
    expect(raised).toHaveLength(1);
    expect(await ageing.history(id)).toHaveLength(2);
  });

  it('stops chasing a document once it is signed', async () => {
    const [{ id }] = (
      await pool.query<{ id: string }>("select id from documents where project_id = $1 and state = 'Final'", [projectId])
    ).rows;
    await docs.transition(id, 'Signed', as('approver'));

    const panel = await ageing.panel(new Date(), projectId);
    expect(panel.items.find((i) => i.documentId === id)).toBeUndefined();
    expect(await ageing.run(new Date(), as('admin'), projectId)).toEqual([]);
  });

  it('writes an audit event for every reminder raised, and the chain stays whole', async () => {
    const id = await agedFinal('v2', 15);
    await ageing.run(new Date(), as('admin'), projectId);
    const events = await new (await import('../src/audit/audit.repository')).AuditRepository(pool).forSubject(
      'document',
      id,
    );
    expect(events.map((e) => e.action)).toContain('reminder.overdue');
    expect((await new (await import('../src/audit/audit.repository')).AuditRepository(pool).verifyChain()).ok).toBe(true);
  });

  it('keeps the reminder record append-only', async () => {
    await expect(pool.query("update reminders set level = 'warning'")).rejects.toThrow(/append-only/i);
    await expect(pool.query('delete from reminders')).rejects.toThrow(/append-only/i);
  });

  it('delivers to the inbox by default, not to any outside system', async () => {
    expect(new InboxSink().name).toBe('inbox');
    await expect(new InboxSink().deliver()).resolves.toBeUndefined();
  });
});
