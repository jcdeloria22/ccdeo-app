/**
 * DC-09 — the readiness dashboard's data.
 *
 * The query does aggregation only. Every rule about what counts lives in
 * `readiness.ts`, so there is one place to read the rule and one place to test it,
 * rather than a `case` expression in SQL that has to be kept in step with the
 * TypeScript by hand.
 */
import type { Pool } from 'pg';
import type { DocumentState } from '../lifecycle/states';
import {
  slotReadiness,
  summarise,
  type Readiness,
  type SlotInput,
  type SlotReadiness,
  type SlotState,
} from './readiness';

export interface ProjectReadiness {
  readonly projectId: string;
  readonly contractId: string;
  readonly name: string;
  readonly readiness: Readiness;
  readonly slots: readonly SlotReadiness[];
}

interface SlotRow {
  slot_code: string;
  required: boolean;
  state: SlotState;
  document_states: DocumentState[] | null;
}

/**
 * Superseded and Void documents are excluded here rather than downstream: they
 * are not live work, and a superseded approval must not keep a slot looking
 * closed out after it has been replaced.
 */
const SLOT_QUERY = `
  select s.slot_code,
         s.required,
         s.state,
         array_remove(array_agg(d.state), null) as document_states
    from project_slots s
    left join documents d
      on d.project_id = s.project_id
     and d.slot_code = s.slot_code
     and d.state not in ('Superseded', 'Void')
   where s.project_id = $1
   group by s.id, s.slot_code, s.required, s.state, s.position
   order by s.position`;

const toInput = (r: SlotRow): SlotInput => ({
  slotCode: r.slot_code,
  required: r.required,
  slotState: r.state,
  documentStates: r.document_states ?? [],
});

export interface ApprovalDebtItem {
  readonly documentId: string;
  readonly projectId: string;
  readonly contractId: string;
  readonly slotCode: string;
  readonly title: string;
  readonly since: Date;
}

export class ReadinessRepository {
  constructor(private readonly pool: Pool) {}

  async forProject(projectId: string): Promise<ProjectReadiness | null> {
    const p = await this.pool.query<{ id: string; contract_id: string; name: string }>(
      'select id, contract_id, name from projects where id = $1',
      [projectId],
    );
    if (!p.rows.length) return null;

    const { rows } = await this.pool.query<SlotRow>(SLOT_QUERY, [projectId]);
    const inputs = rows.map(toInput);

    return {
      projectId,
      contractId: p.rows[0].contract_id,
      name: p.rows[0].name,
      readiness: summarise(inputs),
      slots: slotReadiness(inputs),
    };
  }

  /** Every project, for the portfolio view. */
  async portfolio(): Promise<ProjectReadiness[]> {
    const { rows } = await this.pool.query<{ id: string }>('select id from projects order by contract_id');
    const out: ProjectReadiness[] = [];
    for (const r of rows) {
      const one = await this.forProject(r.id);
      if (one) out.push(one);
    }
    return out;
  }

  /**
   * Approval debt: what is sitting at Final, waiting for someone to accept it.
   *
   * Listed in full rather than counted, because the useful question is never "how
   * many" — it is which ones, and how long they have been there.
   */
  async approvalDebt(projectId?: string): Promise<ApprovalDebtItem[]> {
    const { rows } = await this.pool.query<{
      id: string; project_id: string; contract_id: string; slot_code: string; title: string; state_since: Date;
    }>(
      `select d.id, d.project_id, p.contract_id, d.slot_code, d.title, d.state_since
         from documents d
         join projects p on p.id = d.project_id
        where d.state = 'Final'
          and ($1::uuid is null or d.project_id = $1)
        order by d.state_since`,
      [projectId ?? null],
    );
    return rows.map((r) => ({
      documentId: r.id,
      projectId: r.project_id,
      contractId: r.contract_id,
      slotCode: r.slot_code,
      title: r.title,
      since: r.state_since,
    }));
  }
}
