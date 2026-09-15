/**
 * DC-04 — the audit trail.
 *
 * Append only. Every event carries the hash of the one before it, so the chain
 * can be verified end to end and any alteration shows up as a break at a known
 * point rather than as a silently different history.
 *
 * The hash covers the event's content AND its predecessor's hash. Changing any
 * field of any row invalidates that row and every row after it.
 */
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Actor } from '../operator/operator';

export interface AuditEvent {
  readonly id: string;
  readonly occurredAt: Date;
  readonly actorId: string;
  readonly actorRole: string;
  readonly action: string;
  readonly subjectType: string;
  readonly subjectId: string | null;
  readonly detail: Record<string, unknown>;
  readonly prevHash: string | null;
  readonly hash: string;
}

export interface NewAuditEvent {
  readonly action: string;
  readonly subjectType: string;
  readonly subjectId?: string | null;
  readonly detail?: Record<string, unknown>;
}

/**
 * Canonical form for hashing.
 *
 * Object key order must not change the hash, or a round-trip through JSON could
 * appear to be tampering. Keys are sorted at every level.
 */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const parts = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`);
  return `{${parts.join(',')}}`;
}

export interface HashInput {
  readonly prevHash: string | null;
  readonly occurredAt: string;
  readonly actorId: string;
  readonly actorRole: string;
  readonly action: string;
  readonly subjectType: string;
  readonly subjectId: string | null;
  readonly detail: Record<string, unknown>;
}

export function hashEvent(input: HashInput): string {
  return createHash('sha256').update(canonical(input), 'utf8').digest('hex');
}

interface Row {
  id: string;
  occurred_at: Date;
  actor_id: string;
  actor_role: string;
  action: string;
  subject_type: string;
  subject_id: string | null;
  detail: Record<string, unknown>;
  prev_hash: string | null;
  hash: string;
}

const toEvent = (r: Row): AuditEvent => ({
  id: String(r.id),
  occurredAt: r.occurred_at,
  actorId: r.actor_id,
  actorRole: r.actor_role,
  action: r.action,
  subjectType: r.subject_type,
  subjectId: r.subject_id,
  detail: r.detail,
  prevHash: r.prev_hash,
  hash: r.hash,
});

const COLUMNS =
  'id, occurred_at, actor_id, actor_role, action, subject_type, subject_id, detail, prev_hash, hash';

export interface ChainVerification {
  readonly ok: boolean;
  readonly checked: number;
  /** id of the first row whose hash does not match, if any. */
  readonly brokenAt: string | null;
  readonly reason: string | null;
}

export class AuditRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Append an event.
   *
   * The read of the previous hash and the insert must not interleave with another
   * append, or two events could claim the same predecessor and the chain would
   * fork. `pg_advisory_xact_lock` serialises appends for the length of the
   * transaction — cheaper than locking the table and released automatically.
   */
  async append(event: NewAuditEvent, actor: Actor, client?: PoolClient): Promise<AuditEvent> {
    const run = async (c: PoolClient): Promise<AuditEvent> => {
      await c.query('select pg_advisory_xact_lock(hashtext($1))', ['audit_events']);

      const prev = await c.query<{ hash: string }>('select hash from audit_events order by id desc limit 1');
      const prevHash = prev.rows.length ? prev.rows[0].hash : null;

      const occurredAt = new Date().toISOString();
      const detail = event.detail ?? {};
      const subjectId = event.subjectId ?? null;

      const hash = hashEvent({
        prevHash,
        occurredAt,
        actorId: actor.id,
        actorRole: actor.role,
        action: event.action,
        subjectType: event.subjectType,
        subjectId,
        detail,
      });

      const { rows } = await c.query<Row>(
        `insert into audit_events
           (occurred_at, actor_id, actor_role, action, subject_type, subject_id, detail, prev_hash, hash)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning ${COLUMNS}`,
        [occurredAt, actor.id, actor.role, event.action, event.subjectType, subjectId, detail, prevHash, hash],
      );
      return toEvent(rows[0]);
    };

    if (client) return run(client);

    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const out = await run(c);
      await c.query('commit');
      return out;
    } catch (err) {
      await c.query('rollback');
      throw err;
    } finally {
      c.release();
    }
  }

  /**
   * The most recent `limit` events, oldest first.
   *
   * The inner query takes the newest by `id desc`; the outer one puts them back
   * in chain order. `order by id limit $1` on its own reads as "the first page"
   * and is the opposite of what this screen is for — it returns the OLDEST rows,
   * so once the trail passed the limit the audit screen would have shown the
   * system's first 200 events forever and never anything that just happened.
   *
   * Ascending is what callers get, because the chain only reads in that
   * direction; the screen reverses it to put the newest at the top.
   */
  async list(limit = 100): Promise<AuditEvent[]> {
    const { rows } = await this.pool.query<Row>(
      `select ${COLUMNS} from (
         select ${COLUMNS} from audit_events order by id desc limit $1
       ) recent order by id`,
      [limit],
    );
    return rows.map(toEvent);
  }

  async forSubject(subjectType: string, subjectId: string): Promise<AuditEvent[]> {
    const { rows } = await this.pool.query<Row>(
      `select ${COLUMNS} from audit_events where subject_type = $1 and subject_id = $2 order by id`,
      [subjectType, subjectId],
    );
    return rows.map(toEvent);
  }

  /** Recompute every hash in order and report the first break. */
  async verifyChain(): Promise<ChainVerification> {
    const { rows } = await this.pool.query<Row>(`select ${COLUMNS} from audit_events order by id`);

    let prevHash: string | null = null;
    let checked = 0;

    for (const r of rows) {
      const e = toEvent(r);
      if (e.prevHash !== prevHash) {
        return {
          ok: false,
          checked,
          brokenAt: e.id,
          reason: `prev_hash does not match the previous row (expected ${prevHash ?? 'null'}, found ${e.prevHash ?? 'null'})`,
        };
      }
      const expected = hashEvent({
        prevHash,
        occurredAt: e.occurredAt.toISOString(),
        actorId: e.actorId,
        actorRole: e.actorRole,
        action: e.action,
        subjectType: e.subjectType,
        subjectId: e.subjectId,
        detail: e.detail,
      });
      if (expected !== e.hash) {
        return { ok: false, checked, brokenAt: e.id, reason: 'row content does not match its hash' };
      }
      prevHash = e.hash;
      checked++;
    }
    return { ok: true, checked, brokenAt: null, reason: null };
  }
}
