/**
 * DC-09 — readiness.
 *
 * The rule under test is a rule about honesty: Signed counts, Final does not, and
 * the percentage never rounds its way to a number that says "ready" when the set
 * is not. Most of this is exercised without a database, because the arithmetic is
 * a pure function; the repository tests prove the query feeds it the right rows.
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
import { ReadinessRepository } from '../src/readiness/readiness.repository';
import { outcomeOf, summarise, progressRank, type SlotInput } from '../src/readiness/readiness';
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

const slot = (over: Partial<SlotInput> = {}): SlotInput => ({
  slotCode: 'qcp',
  required: true,
  slotState: 'Pending',
  documentStates: [],
  ...over,
});

describe('what a slot amounts to', () => {
  it('is empty with no documents', () => {
    expect(outcomeOf(slot())).toBe('empty');
  });

  it('is in progress while a document is Draft or In Review', () => {
    expect(outcomeOf(slot({ documentStates: ['Draft'] }))).toBe('in-progress');
    expect(outcomeOf(slot({ documentStates: ['In Review'] }))).toBe('in-progress');
  });

  it('is awaiting approval at Final — NOT closed out', () => {
    expect(outcomeOf(slot({ documentStates: ['Final'] }))).toBe('awaiting-approval');
  });

  it('is signed at Signed and at Archived', () => {
    expect(outcomeOf(slot({ documentStates: ['Signed'] }))).toBe('signed');
    expect(outcomeOf(slot({ documentStates: ['Archived'] }))).toBe('signed');
  });

  it('takes the most advanced live document when there are several', () => {
    expect(outcomeOf(slot({ documentStates: ['Draft', 'Signed'] }))).toBe('signed');
    expect(outcomeOf(slot({ documentStates: ['Final', 'Draft'] }))).toBe('awaiting-approval');
  });

  it('is waived when the slot is waived and nothing is signed', () => {
    expect(outcomeOf(slot({ slotState: 'Waived' }))).toBe('waived');
    expect(outcomeOf(slot({ slotState: 'Waived', documentStates: ['Draft'] }))).toBe('waived');
  });

  it('reports a signed document even on a waived slot — the work exists', () => {
    expect(outcomeOf(slot({ slotState: 'Waived', documentStates: ['Signed'] }))).toBe('signed');
  });

  it('does not treat a Filled slot as done — a clean upload is not an approval', () => {
    expect(outcomeOf(slot({ slotState: 'Filled' }))).toBe('empty');
    expect(outcomeOf(slot({ slotState: 'Filled', documentStates: ['Final'] }))).toBe('awaiting-approval');
  });

  it('ranks the lifecycle in order and ignores the branches', () => {
    expect(progressRank('Draft')).toBeLessThan(progressRank('Final'));
    expect(progressRank('Final')).toBeLessThan(progressRank('Signed'));
    expect(progressRank('Void')).toBe(0);
    expect(progressRank('Superseded')).toBe(0);
  });
});

describe('the readiness figure', () => {
  it('counts Signed and never Final', () => {
    const r = summarise([
      slot({ slotCode: 'a', documentStates: ['Signed'] }),
      slot({ slotCode: 'b', documentStates: ['Final'] }),
    ]);
    expect(r.signed).toBe(1);
    expect(r.awaitingApproval).toBe(1);
    expect(r.closedOut).toBe(1);
    expect(r.percent).toBe(50);
  });

  it('does not move when a document is finalized — only when it is signed', () => {
    const before = summarise([slot({ slotCode: 'a', documentStates: ['Draft'] }), slot({ slotCode: 'b' })]);
    const finalized = summarise([slot({ slotCode: 'a', documentStates: ['Final'] }), slot({ slotCode: 'b' })]);
    expect(finalized.percent).toBe(before.percent);
    expect(finalized.awaitingApproval).toBe(1);

    const signed = summarise([slot({ slotCode: 'a', documentStates: ['Signed'] }), slot({ slotCode: 'b' })]);
    expect(signed.percent).toBe(50);
  });

  it('counts a waiver as closed out', () => {
    const r = summarise([slot({ slotCode: 'a', slotState: 'Waived' }), slot({ slotCode: 'b', documentStates: ['Signed'] })]);
    expect(r.waived).toBe(1);
    expect(r.complete).toBe(true);
    expect(r.percent).toBe(100);
  });

  it('never rounds up to 100 when something is outstanding', () => {
    const slots = Array.from({ length: 200 }, (_, i) =>
      slot({ slotCode: `s${i}`, documentStates: i === 0 ? [] : ['Signed'] }),
    );
    const r = summarise(slots);
    expect(r.ratio).toBeCloseTo(199 / 200);
    expect(r.percent).toBe(99);
    expect(r.complete).toBe(false);
  });

  it('reaches 100 only when every required slot is closed out', () => {
    const r = summarise([slot({ slotCode: 'a', documentStates: ['Signed'] })]);
    expect(r.percent).toBe(100);
    expect(r.complete).toBe(true);
  });

  it('calls an empty set unknown, not complete', () => {
    const r = summarise([]);
    expect(r.ratio).toBeNull();
    expect(r.percent).toBeNull();
    expect(r.complete).toBe(false);
  });

  it('keeps optional slots out of the percentage', () => {
    const r = summarise([
      slot({ slotCode: 'a', documentStates: ['Signed'] }),
      slot({ slotCode: 'b', required: false }),
      slot({ slotCode: 'c', required: false, documentStates: ['Signed'] }),
    ]);
    expect(r.requiredTotal).toBe(1);
    expect(r.percent).toBe(100);
    expect(r.optionalTotal).toBe(2);
    expect(r.optionalSigned).toBe(1);
  });
});

run('DC-09 readiness against the database', () => {
  let pool: Pool;
  let dir: string;
  let docs: DocumentsRepository;
  let uploads: UploadsRepository;
  let slots: SlotsRepository;
  let readiness: ReadinessRepository;
  let projectId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await migrate(pool);
    await pool.query('truncate table documents, approvals, document_transitions cascade');
    await pool.query('truncate table uploads, project_slots cascade');
    await pool.query("delete from projects where contract_id like '26RD%'");
    await pool.query("delete from slot_templates where code = 'rd-set'");

    dir = await mkdtemp(path.join(os.tmpdir(), 'dpwh-rd-'));
    const storage = new FilesystemStorage(dir);
    slots = new SlotsRepository(pool);
    uploads = new UploadsRepository(pool, storage, cleanScanner);
    docs = new DocumentsRepository(pool);
    readiness = new ReadinessRepository(pool);

    const t = await slots.createVersion(
      {
        code: 'rd-set',
        name: 'Readiness fixture',
        items: [
          { slotCode: 'qcp', name: 'QCP', required: true },
          { slotCode: 'mix-design', name: 'Mix design', required: true },
          { slotCode: 'trial-section', name: 'Trial section', required: false },
        ],
      },
      as('admin'),
    );
    await slots.publish(t.id);
    projectId = (await new ProjectsRepository(pool).create(
      { contractId: '26RD0001', name: 'Readiness fixture' },
      as('admin'),
    )).id;
    await slots.instantiate(projectId, 'rd-set');
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  /** A document in the given slot, carried to `upTo`. */
  const document = async (slotCode: string, upTo: 'Draft' | 'Final' | 'Signed', body: string) => {
    const u = await uploads.upload(
      { projectId, slotCode, filename: `${slotCode}.pdf`, bytes: Buffer.from(body) },
      as('admin'),
    );
    await uploads.scan(u.id);
    const d = await docs.create({ projectId, slotCode, title: slotCode, uploadId: u.id }, as('materials_engineer'));
    if (upTo === 'Draft') return d;
    const final = await docs.transition(d.id, 'Final', as('materials_engineer'));
    if (upTo === 'Final') return final;
    return docs.transition(d.id, 'Signed', as('approver'));
  };

  it('starts at zero with an unknown-free denominator', async () => {
    const r = (await readiness.forProject(projectId))!;
    expect(r.readiness.requiredTotal).toBe(2);
    expect(r.readiness.optionalTotal).toBe(1);
    expect(r.readiness.percent).toBe(0);
    expect(r.slots.map((s) => s.outcome)).toEqual(['empty', 'empty', 'empty']);
  });

  it('stays at zero when a document is only finalized, and reports the debt', async () => {
    await document('qcp', 'Final', 'qcp v1');
    const r = (await readiness.forProject(projectId))!;
    expect(r.readiness.percent).toBe(0);
    expect(r.readiness.awaitingApproval).toBe(1);

    const debt = await readiness.approvalDebt(projectId);
    expect(debt).toHaveLength(1);
    expect(debt[0].slotCode).toBe('qcp');
    expect(debt[0].since).toBeInstanceOf(Date);
  });

  it('moves only when the approver signs', async () => {
    const qcp = (await pool.query<{ id: string }>(
      "select id from documents where project_id = $1 and slot_code = 'qcp' and state = 'Final'",
      [projectId],
    )).rows[0];
    await docs.transition(qcp.id, 'Signed', as('approver'));

    const r = (await readiness.forProject(projectId))!;
    expect(r.readiness.signed).toBe(1);
    expect(r.readiness.percent).toBe(50);
    expect(await readiness.approvalDebt(projectId)).toHaveLength(0);
  });

  it('does not let an optional slot push the figure past what is required', async () => {
    await document('trial-section', 'Signed', 'trial v1');
    const r = (await readiness.forProject(projectId))!;
    expect(r.readiness.percent).toBe(50);
    expect(r.readiness.optionalSigned).toBe(1);
  });

  it('counts a waived slot as closed out and completes the set', async () => {
    await slots.waive(projectId, 'mix-design', 'Not applicable — no asphalt works in this contract', as('admin'));
    const r = (await readiness.forProject(projectId))!;
    expect(r.readiness.waived).toBe(1);
    expect(r.readiness.complete).toBe(true);
    expect(r.readiness.percent).toBe(100);
  });

  it('drops a slot back when its signed document is superseded', async () => {
    const qcp = (await pool.query<{ id: string }>(
      "select id from documents where project_id = $1 and slot_code = 'qcp' and state = 'Signed'",
      [projectId],
    )).rows[0];
    const u = await uploads.upload(
      { projectId, slotCode: 'qcp', filename: 'qcp-rev2.pdf', bytes: Buffer.from('qcp v2') },
      as('admin'),
    );
    await uploads.scan(u.id);
    await docs.supersede(qcp.id, u.id, 'Revised after review', as('admin'));

    const r = (await readiness.forProject(projectId))!;
    expect(r.slots.find((s) => s.slotCode === 'qcp')!.outcome).toBe('in-progress');
    expect(r.readiness.signed).toBe(0);
    expect(r.readiness.complete).toBe(false);
  });

  it('ignores voided documents entirely', async () => {
    const d = await document('mix-design', 'Draft', 'mix v1');
    await docs.transition(d.id, 'Void', as('approver'), { reason: 'raised against the wrong contract' });
    const r = (await readiness.forProject(projectId))!;
    // the slot is still waived; the void document contributes nothing
    expect(r.slots.find((s) => s.slotCode === 'mix-design')!.outcome).toBe('waived');
  });

  it('lists every project in the portfolio view', async () => {
    const all = await readiness.portfolio();
    expect(all.some((p) => p.contractId === '26RD0001')).toBe(true);
    for (const p of all) expect(p.readiness.requiredTotal).toBeGreaterThanOrEqual(0);
  });

  it('returns nothing for a project that does not exist', async () => {
    expect(await readiness.forProject('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});
