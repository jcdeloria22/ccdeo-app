/**
 * DC-05 — versioned slot templates.
 *
 * The test that matters is the last one: publishing a new version must NOT
 * change a project that already exists. Everything else is plumbing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { migrate } from '../src/db/migrate';
import { SlotsRepository, NoActiveTemplateError, WaiverNeedsReasonError } from '../src/slots/slots.repository';
import { ProjectsRepository } from '../src/projects/projects.repository';
import { PROVISIONAL_ITEMS, PROVISIONAL_SOURCE_NOTE } from '../src/slots/provisional-template';
import { seededOperator } from '../src/operator/operator';
import { loadEnv } from '../src/config/env';

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;

const actor = seededOperator(
  loadEnv({ AUTH_MODE: 'none', OPERATOR_NAME: 'Jayz', OPERATOR_EMAIL: 'jayz@example.com' } as NodeJS.ProcessEnv),
  'materials_engineer',
);

run('DC-05 slot templates', () => {
  let pool: Pool;
  let slots: SlotsRepository;
  let projects: ProjectsRepository;
  const CODE = 'test-set';

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await migrate(pool);
    await pool.query('truncate table project_slots, slot_template_items, slot_templates cascade');
    await pool.query("delete from projects where contract_id like '26TS%'");
    slots = new SlotsRepository(pool);
    projects = new ProjectsRepository(pool);
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it('creates version 1 as a draft', async () => {
    const t = await slots.createVersion(
      { code: CODE, name: 'Test set', items: PROVISIONAL_ITEMS.map((i) => ({ ...i })), sourceNote: PROVISIONAL_SOURCE_NOTE },
      actor,
    );
    expect(t.version).toBe(1);
    expect(t.status).toBe('draft');
  });

  it('marks an unsourced list provisional, and says why', async () => {
    const t = await slots.activeTemplate(CODE);
    expect(t).toBeNull(); // still a draft
    const { rows } = await pool.query('select provisional, source_note from slot_templates where code = $1', [CODE]);
    expect(rows[0].provisional).toBe(true);
    expect(rows[0].source_note).toContain('PROVISIONAL');
  });

  it('refuses to instantiate from a template with no active version', async () => {
    const p = await projects.create({ contractId: '26TS0001', name: 'Slots fixture' }, actor);
    await expect(slots.instantiate(p.id, CODE)).rejects.toBeInstanceOf(NoActiveTemplateError);
  });

  it('publishes version 1', async () => {
    const drafts = await pool.query<{ id: string }>('select id from slot_templates where code = $1 and version = 1', [CODE]);
    const t = await slots.publish(drafts.rows[0].id);
    expect(t.status).toBe('active');
  });

  it('copies the active template onto a project, in order', async () => {
    const p = await projects.findByContractId('26TS0001');
    const made = await slots.instantiate(p!.id, CODE);
    expect(made).toHaveLength(PROVISIONAL_ITEMS.length);
    expect(made.map((s) => s.slotCode)).toEqual(PROVISIONAL_ITEMS.map((i) => i.slotCode));
    expect(made.every((s) => s.state === 'Pending')).toBe(true);
  });

  it('keeps required and optional distinct', async () => {
    const p = await projects.findByContractId('26TS0001');
    const list = await slots.forProject(p!.id);
    expect(list.find((s) => s.slotCode === 'trial-mix')!.required).toBe(false);
    expect(list.find((s) => s.slotCode === 'qcp')!.required).toBe(true);
  });

  it('refuses a waiver with no reason', async () => {
    const p = await projects.findByContractId('26TS0001');
    await expect(slots.waive(p!.id, 'trial-mix', '   ', actor)).rejects.toBeInstanceOf(WaiverNeedsReasonError);
  });

  it('refuses a reasonless waiver at the database too, not only in code', async () => {
    const p = await projects.findByContractId('26TS0001');
    await expect(
      pool.query("update project_slots set state = 'Waived' where project_id = $1 and slot_code = 'qcp'", [p!.id]),
    ).rejects.toThrow();
  });

  it('waives a slot with a reason', async () => {
    const p = await projects.findByContractId('26TS0001');
    const s = await slots.waive(p!.id, 'trial-mix', 'No concrete on this contract', actor);
    expect(s.state).toBe('Waived');
    expect(s.waivedReason).toBe('No concrete on this contract');
  });

  /**
   * The point of versioning. A set that silently gained a requirement after the
   * fact would make every readiness figure computed before it a lie.
   */
  it('does NOT change an existing project when a new version is published', async () => {
    const p = await projects.findByContractId('26TS0001');
    const before = await slots.forProject(p!.id);

    const v2 = await slots.createVersion(
      {
        code: CODE,
        name: 'Test set v2',
        items: [...PROVISIONAL_ITEMS.map((i) => ({ ...i })), { slotCode: 'extra', name: 'A newly required document', required: true }],
      },
      actor,
    );
    expect(v2.version).toBe(2);
    await slots.publish(v2.id);

    const after = await slots.forProject(p!.id);
    expect(after).toHaveLength(before.length);
    expect(after.map((s) => s.slotCode)).not.toContain('extra');
  });

  it('supersedes the previous version, leaving exactly one active', async () => {
    const { rows } = await pool.query<{ version: number; status: string }>(
      'select version, status from slot_templates where code = $1 order by version',
      [CODE],
    );
    expect(rows.find((r) => r.version === 1)!.status).toBe('superseded');
    expect(rows.find((r) => r.version === 2)!.status).toBe('active');
    expect(rows.filter((r) => r.status === 'active')).toHaveLength(1);
  });

  it('gives a NEW project the new version', async () => {
    const p2 = await projects.create({ contractId: '26TS0002', name: 'Later project' }, actor);
    const made = await slots.instantiate(p2.id, CODE);
    expect(made.map((s) => s.slotCode)).toContain('extra');
  });

  it('will not let two active versions exist, even by direct update', async () => {
    const { rows } = await pool.query<{ id: string }>(
      "select id from slot_templates where code = $1 and version = 1",
      [CODE],
    );
    await expect(
      pool.query("update slot_templates set status = 'active' where id = $1", [rows[0].id]),
    ).rejects.toThrow();
  });
});
