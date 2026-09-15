/**
 * DC-10 — the ageing panel and the reminder engine.
 *
 * The engine does two separable things and they are kept separable: working out
 * what is due (pure, in `ageing.ts`) and recording that it was raised (here). The
 * record is what makes running the engine on a schedule safe — the database's
 * unique key, not the engine's memory, is what stops a reminder going twice.
 *
 * Delivery is an in-app inbox, decided 15 September 2026. Nothing here sends
 * mail: there is no mail configuration in this project and inventing one would
 * mean handling credentials. The `reminders` row IS the delivery — `InboxRepository`
 * reads it — which means a reminder cannot be "sent" and also missing.
 *
 * `ReminderSink` stays as a seam anyway. If mail or a chat webhook is ever wanted
 * it is one class, and the inbox keeps working alongside it rather than being
 * replaced by it.
 */
import type { Pool } from 'pg';
import type { Actor } from '../operator/operator';
import { isTerminal, type DocumentState } from '../lifecycle/states';
import { AuditRepository } from '../audit/audit.repository';
import { DEFAULT_SLAS, type Sla } from './sla';
import {
  ageAll,
  remindersDue,
  summariseAgeing,
  type AgedItem,
  type AgeingItem,
  type AgeingSummary,
  type Reminder,
} from './ageing';

export interface AgeingPanel {
  readonly items: readonly AgedItem[];
  readonly summary: AgeingSummary;
  readonly asOf: Date;
  /** True while any SLA driving this panel is still unconfirmed. */
  readonly provisionalSlas: boolean;
}

/** An extra destination for a raised reminder, beyond the inbox it already lands in. */
export interface ReminderSink {
  readonly name: string;
  deliver(reminder: Reminder): Promise<void>;
}

/**
 * The default: the inbox, and nowhere else.
 *
 * It does nothing on purpose. The row written to `reminders` is what the inbox
 * reads, so the reminder has already been delivered by the time this is called —
 * there is no second system that could fail and leave the two disagreeing.
 */
export class InboxSink implements ReminderSink {
  readonly name = 'inbox';
  async deliver(): Promise<void> {
    /* The record in `reminders` is the delivery; InboxRepository reads it. */
  }
}

interface ItemRow {
  id: string;
  project_id: string;
  contract_id: string;
  slot_code: string;
  title: string;
  state: DocumentState;
  state_since: Date;
}

const toItem = (r: ItemRow): AgeingItem => ({
  documentId: r.id,
  projectId: r.project_id,
  contractId: r.contract_id,
  slotCode: r.slot_code,
  title: r.title,
  state: r.state,
  stateSince: r.state_since,
});

/**
 * The query selects states that have a clock, and takes that list from the SLA
 * table rather than naming states itself.
 *
 * Filtering later would put rows on the panel that can never need attention —
 * Signed is finished work, the terminal states are over — and a hardcoded list
 * here would be a second copy of the SLA table, free to drift from the real one.
 */
const ITEMS = `
  select d.id, d.project_id, p.contract_id, d.slot_code, d.title, d.state, d.state_since
    from documents d
    join projects p on p.id = d.project_id
   where d.state = any($2::text[])
     and ($1::uuid is null or d.project_id = $1)`;

export class AgeingRepository {
  private readonly audit: AuditRepository;

  constructor(
    private readonly pool: Pool,
    private readonly slas: readonly Sla[] = DEFAULT_SLAS,
    private readonly sink: ReminderSink = new InboxSink(),
  ) {
    this.audit = new AuditRepository(pool);
  }

  /** The states a clock actually runs in. A terminal state never qualifies, whatever the table says. */
  private trackedStates(): DocumentState[] {
    return this.slas.filter((s) => !isTerminal(s.state)).map((s) => s.state);
  }

  private async items(projectId?: string): Promise<AgeingItem[]> {
    const tracked = this.trackedStates();
    if (!tracked.length) return [];
    const { rows } = await this.pool.query<ItemRow>(ITEMS, [projectId ?? null, tracked]);
    return rows.map(toItem);
  }

  /** The panel: everything with a clock, oldest first. */
  async panel(now: Date, projectId?: string): Promise<AgeingPanel> {
    const items = ageAll(await this.items(projectId), now, this.slas);
    return {
      items,
      summary: summariseAgeing(items),
      asOf: now,
      provisionalSlas: this.slas.some((s) => s.provisional),
    };
  }

  /**
   * Run the engine.
   *
   * Returns only the reminders this run actually raised. Running twice over the
   * same state of the world raises nothing the second time — `on conflict do
   * nothing` means that holds even if two runs overlap.
   */
  async run(now: Date, actor: Actor, projectId?: string): Promise<Reminder[]> {
    const due = remindersDue(await this.items(projectId), now, this.slas);
    const raised: Reminder[] = [];

    for (const r of due) {
      const { rows } = await this.pool.query<{ id: string }>(
        `insert into reminders (document_id, state, state_since, level, age_days, reason)
         values ($1, $2, $3, $4, $5, $6)
         on conflict on constraint reminders_once do nothing
         returning id`,
        [r.documentId, r.state, r.stateSince, r.level, r.ageDays.toFixed(3), r.reason],
      );
      if (!rows.length) continue; // already raised for this clock

      await this.audit.append(
        {
          action: `reminder.${r.level}`,
          subjectType: 'document',
          subjectId: r.documentId,
          detail: { state: r.state, level: r.level, ageDays: Number(r.ageDays.toFixed(3)), sink: this.sink.name },
        },
        actor,
      );
      await this.sink.deliver(r);
      raised.push(r);
    }

    return raised;
  }

  async history(documentId: string): Promise<Reminder[]> {
    const { rows } = await this.pool.query<{
      document_id: string; state: DocumentState; state_since: Date; level: 'warning' | 'overdue';
      age_days: string; reason: string;
    }>(
      `select document_id, state, state_since, level, age_days, reason
         from reminders where document_id = $1 order by created_at, id`,
      [documentId],
    );
    return rows.map((r) => ({
      documentId: r.document_id,
      state: r.state,
      stateSince: r.state_since,
      level: r.level,
      ageDays: Number(r.age_days),
      reason: r.reason,
    }));
  }
}
