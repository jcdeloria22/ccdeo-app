/**
 * The reminder inbox — the space reminders are delivered to.
 *
 * Decided 15 September 2026: reminders go to a place in the app rather than to
 * email. That suits a build that handles no credentials — there is no mail
 * server to configure and no secret to leak — and it keeps the record and the
 * delivery as the same thing, so a reminder cannot be "sent" and also missing.
 *
 * Read state is a separate append-only table rather than a column, because
 * `reminders` is append-only: marking something read is a new fact about an old
 * event, not an edit to it. The cost is a join; the gain is that "who saw this,
 * and when" survives instead of collapsing into a boolean.
 */
import type { Pool } from 'pg';
import type { Actor } from '../operator/operator';
import type { DocumentState } from '../lifecycle/states';
import type { ReminderLevel } from '../ageing/ageing';

export interface InboxItem {
  readonly reminderId: string;
  readonly documentId: string;
  readonly projectId: string;
  readonly contractId: string;
  readonly slotCode: string;
  readonly title: string;
  readonly state: DocumentState;
  readonly level: ReminderLevel;
  readonly ageDays: number;
  readonly reason: string;
  readonly raisedAt: Date;
  /** Null while nobody has read it. */
  readonly acknowledgedAt: Date | null;
  readonly acknowledgedBy: string | null;
}

export interface InboxCounts {
  readonly unread: number;
  readonly unreadOverdue: number;
  readonly unreadWarning: number;
  readonly total: number;
}

export interface InboxQuery {
  readonly projectId?: string;
  readonly unreadOnly?: boolean;
  readonly limit?: number;
}

interface Row {
  reminder_id: string;
  document_id: string;
  project_id: string;
  contract_id: string;
  slot_code: string;
  title: string;
  state: DocumentState;
  level: ReminderLevel;
  age_days: string;
  reason: string;
  raised_at: Date;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
}

const toItem = (r: Row): InboxItem => ({
  reminderId: r.reminder_id,
  documentId: r.document_id,
  projectId: r.project_id,
  contractId: r.contract_id,
  slotCode: r.slot_code,
  title: r.title,
  state: r.state,
  level: r.level,
  ageDays: Number(r.age_days),
  reason: r.reason,
  raisedAt: r.raised_at,
  acknowledgedAt: r.acknowledged_at,
  acknowledgedBy: r.acknowledged_by,
});

/**
 * Acknowledgement is per person, so the inbox is read from the point of view of
 * whoever is looking. With one operator that is a distinction without a
 * difference; the moment a second person has an account it stops being one, and
 * building it the other way would mean one person's click silently clearing
 * everyone else's inbox.
 */
const SELECT = `
  select r.id as reminder_id, r.document_id, d.project_id, p.contract_id, d.slot_code, d.title,
         r.state, r.level, r.age_days, r.reason, r.created_at as raised_at,
         a.acknowledged_at, a.actor_id as acknowledged_by
    from reminders r
    join documents d on d.id = r.document_id
    join projects  p on p.id = d.project_id
    left join reminder_acknowledgements a
      on a.reminder_id = r.id and a.actor_id = $1`;

export class InboxRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * What is in the inbox.
   *
   * Unread first, then most severe, then oldest. A panel exists to be acted on
   * from the top, and an overdue item nobody has seen is the thing most worth
   * looking at.
   */
  async list(actor: Actor, query: InboxQuery = {}): Promise<InboxItem[]> {
    const { rows } = await this.pool.query<Row>(
      `${SELECT}
        where ($2::uuid is null or d.project_id = $2)
          and ($3::boolean is not true or a.id is null)
        order by (a.id is null) desc,
                 case r.level when 'overdue' then 0 else 1 end,
                 r.created_at
        limit $4`,
      [actor.id, query.projectId ?? null, query.unreadOnly ?? false, query.limit ?? 200],
    );
    return rows.map(toItem);
  }

  /** The number on the tab. */
  async counts(actor: Actor, projectId?: string): Promise<InboxCounts> {
    const { rows } = await this.pool.query<{
      unread: string; unread_overdue: string; unread_warning: string; total: string;
    }>(
      `select
         count(*) filter (where a.id is null)                              as unread,
         count(*) filter (where a.id is null and r.level = 'overdue')      as unread_overdue,
         count(*) filter (where a.id is null and r.level = 'warning')      as unread_warning,
         count(*)                                                          as total
       from reminders r
       join documents d on d.id = r.document_id
       left join reminder_acknowledgements a on a.reminder_id = r.id and a.actor_id = $1
      where ($2::uuid is null or d.project_id = $2)`,
      [actor.id, projectId ?? null],
    );
    const r = rows[0];
    return {
      unread: Number(r.unread),
      unreadOverdue: Number(r.unread_overdue),
      unreadWarning: Number(r.unread_warning),
      total: Number(r.total),
    };
  }

  async find(actor: Actor, reminderId: string): Promise<InboxItem | null> {
    const { rows } = await this.pool.query<Row>(`${SELECT} where r.id = $2`, [actor.id, reminderId]);
    return rows.length ? toItem(rows[0]) : null;
  }

  /**
   * Mark one as read.
   *
   * Idempotent by the unique key rather than by checking first, so two clicks
   * that race cannot produce two rows or an error. Returns whether this call was
   * the one that recorded it.
   */
  async acknowledge(actor: Actor, reminderId: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ id: string }>(
      `insert into reminder_acknowledgements (reminder_id, actor_id, actor_role)
       values ($1, $2, $3)
       on conflict on constraint reminder_acknowledgements_once do nothing
       returning id`,
      [reminderId, actor.id, actor.role],
    );
    return rows.length > 0;
  }

  /** Clear the tab. Returns how many were newly acknowledged. */
  async acknowledgeAll(actor: Actor, projectId?: string): Promise<number> {
    const { rowCount } = await this.pool.query(
      `insert into reminder_acknowledgements (reminder_id, actor_id, actor_role)
       select r.id, $1, $2
         from reminders r
         join documents d on d.id = r.document_id
        where ($3::uuid is null or d.project_id = $3)
       on conflict on constraint reminder_acknowledgements_once do nothing`,
      [actor.id, actor.role, projectId ?? null],
    );
    return rowCount ?? 0;
  }
}
