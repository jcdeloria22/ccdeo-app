/**
 * DC-05 — versioned slot templates.
 *
 * A template defines the documents a set requires. Publishing a new version
 * supersedes the old one for *future* projects; projects already created keep the
 * version they were created under. Readiness figures computed last month must
 * still mean what they said.
 */
import type { Pool, PoolClient } from 'pg';
import type { Actor } from '../operator/operator';

export interface SlotTemplate {
  readonly id: string;
  readonly code: string;
  readonly version: number;
  readonly name: string;
  readonly status: 'draft' | 'active' | 'superseded';
  readonly provisional: boolean;
  readonly sourceNote: string;
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly createdByRole: string;
}

export interface SlotTemplateItem {
  readonly slotCode: string;
  readonly name: string;
  readonly required: boolean;
  readonly position: number;
}

export interface ProjectSlot {
  readonly id: string;
  readonly projectId: string;
  readonly templateId: string;
  readonly slotCode: string;
  readonly name: string;
  readonly required: boolean;
  readonly position: number;
  readonly state: 'Pending' | 'Filled' | 'Waived';
  readonly waivedReason: string | null;
}

export class NoActiveTemplateError extends Error {
  constructor(code: string) {
    super(`No active version of slot template "${code}". Publish one before creating slots from it.`);
    this.name = 'NoActiveTemplateError';
  }
}

export class WaiverNeedsReasonError extends Error {
  constructor() {
    super('Waiving a slot requires a reason — a waiver without one is just a gap.');
    this.name = 'WaiverNeedsReasonError';
  }
}

const T_COLS =
  'id, code, version, name, status, provisional, source_note, created_at, created_by, created_by_role';

interface TRow {
  id: string; code: string; version: number; name: string;
  status: 'draft' | 'active' | 'superseded'; provisional: boolean; source_note: string;
  created_at: Date; created_by: string; created_by_role: string;
}
const toTemplate = (r: TRow): SlotTemplate => ({
  id: r.id, code: r.code, version: r.version, name: r.name, status: r.status,
  provisional: r.provisional, sourceNote: r.source_note, createdAt: r.created_at,
  createdBy: r.created_by, createdByRole: r.created_by_role,
});

interface SRow {
  id: string; project_id: string; template_id: string; slot_code: string; name: string;
  required: boolean; position: number; state: 'Pending' | 'Filled' | 'Waived'; waived_reason: string | null;
}
const toSlot = (r: SRow): ProjectSlot => ({
  id: r.id, projectId: r.project_id, templateId: r.template_id, slotCode: r.slot_code,
  name: r.name, required: r.required, position: r.position, state: r.state, waivedReason: r.waived_reason,
});

export class SlotsRepository {
  constructor(private readonly pool: Pool) {}

  /** Create the next version of a template. Always starts as a draft. */
  async createVersion(
    input: {
      code: string;
      name: string;
      items: readonly Omit<SlotTemplateItem, 'position'>[];
      provisional?: boolean;
      sourceNote?: string;
    },
    actor: Actor,
  ): Promise<SlotTemplate> {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const { rows: vr } = await c.query<{ next: number }>(
        'select coalesce(max(version), 0) + 1 as next from slot_templates where code = $1',
        [input.code],
      );
      const version = vr[0].next;

      const { rows } = await c.query<TRow>(
        `insert into slot_templates (code, version, name, provisional, source_note, created_by, created_by_role)
         values ($1, $2, $3, $4, $5, $6, $7) returning ${T_COLS}`,
        [
          input.code, version, input.name,
          input.provisional ?? true,
          input.sourceNote ?? 'unverified',
          actor.id, actor.role,
        ],
      );
      const template = toTemplate(rows[0]);

      let position = 0;
      for (const item of input.items) {
        await c.query(
          `insert into slot_template_items (template_id, slot_code, name, required, position)
           values ($1, $2, $3, $4, $5)`,
          [template.id, item.slotCode, item.name, item.required, position++],
        );
      }
      await c.query('commit');
      return template;
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }

  /** Publish a draft: it becomes active and any previous active is superseded. */
  async publish(templateId: string): Promise<SlotTemplate> {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const { rows: cur } = await c.query<TRow>(`select ${T_COLS} from slot_templates where id = $1`, [templateId]);
      if (!cur.length) throw new Error(`No such template: ${templateId}`);

      await c.query(
        `update slot_templates set status = 'superseded' where code = $1 and status = 'active' and id <> $2`,
        [cur[0].code, templateId],
      );
      const { rows } = await c.query<TRow>(
        `update slot_templates set status = 'active' where id = $1 returning ${T_COLS}`,
        [templateId],
      );
      await c.query('commit');
      return toTemplate(rows[0]);
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }

  async activeTemplate(code: string): Promise<SlotTemplate | null> {
    const { rows } = await this.pool.query<TRow>(
      `select ${T_COLS} from slot_templates where code = $1 and status = 'active'`,
      [code],
    );
    return rows.length ? toTemplate(rows[0]) : null;
  }

  async items(templateId: string): Promise<SlotTemplateItem[]> {
    const { rows } = await this.pool.query<{ slot_code: string; name: string; required: boolean; position: number }>(
      'select slot_code, name, required, position from slot_template_items where template_id = $1 order by position',
      [templateId],
    );
    return rows.map((r) => ({ slotCode: r.slot_code, name: r.name, required: r.required, position: r.position }));
  }

  /**
   * Copy the active template onto a project.
   *
   * The copy is the point: the project's slots are now independent of the
   * template, so publishing version 2 tomorrow does not rewrite what this project
   * required today.
   */
  async instantiate(projectId: string, templateCode: string, client?: PoolClient): Promise<ProjectSlot[]> {
    const template = await this.activeTemplate(templateCode);
    if (!template) throw new NoActiveTemplateError(templateCode);

    const items = await this.items(template.id);
    const run = async (c: PoolClient | Pool): Promise<ProjectSlot[]> => {
      const out: ProjectSlot[] = [];
      for (const item of items) {
        const { rows } = await c.query<SRow>(
          `insert into project_slots (project_id, template_id, slot_code, name, required, position)
           values ($1, $2, $3, $4, $5, $6)
           returning id, project_id, template_id, slot_code, name, required, position, state, waived_reason`,
          [projectId, template.id, item.slotCode, item.name, item.required, item.position],
        );
        out.push(toSlot(rows[0]));
      }
      return out;
    };
    return client ? run(client) : run(this.pool);
  }

  async forProject(projectId: string): Promise<ProjectSlot[]> {
    const { rows } = await this.pool.query<SRow>(
      `select id, project_id, template_id, slot_code, name, required, position, state, waived_reason
         from project_slots where project_id = $1 order by position`,
      [projectId],
    );
    return rows.map(toSlot);
  }

  async waive(projectId: string, slotCode: string, reason: string, actor: Actor): Promise<ProjectSlot> {
    if (!reason || !reason.trim()) throw new WaiverNeedsReasonError();
    const { rows } = await this.pool.query<SRow>(
      `update project_slots
          set state = 'Waived', waived_reason = $3, waived_by = $4, waived_at = now()
        where project_id = $1 and slot_code = $2
        returning id, project_id, template_id, slot_code, name, required, position, state, waived_reason`,
      [projectId, slotCode, reason.trim(), actor.id],
    );
    if (!rows.length) throw new Error(`No slot ${slotCode} on project ${projectId}`);
    return toSlot(rows[0]);
  }
}
