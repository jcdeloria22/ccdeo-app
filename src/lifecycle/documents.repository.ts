/**
 * DC-07 / DC-08 — documents, transitions, and approval.
 *
 * Every transition goes through `transition()`. It checks the machine, the role,
 * the reason, freezes content where required, records the transition, writes an
 * audit event, and resets the per-state clock — in one transaction, so a
 * transition can never be half-recorded.
 */
import type { Pool, PoolClient } from 'pg';
import type { Actor } from '../operator/operator';
import { resolve } from '../policy/roles';
import { AuditRepository } from '../audit/audit.repository';
import { findTransition, isTerminal, type DocumentState } from './states';

export interface Document {
  readonly id: string;
  readonly projectId: string;
  readonly slotCode: string;
  readonly title: string;
  readonly state: DocumentState;
  readonly stateSince: Date;
  readonly uploadId: string | null;
  readonly contentHash: string | null;
  readonly supersededBy: string | null;
}

export interface DocumentTransition {
  readonly fromState: DocumentState | null;
  readonly toState: DocumentState;
  readonly reason: string | null;
  readonly contentHash: string | null;
  readonly actorId: string;
  readonly actorRole: string;
  readonly occurredAt: Date;
}

export class IllegalTransitionError extends Error {
  constructor(from: DocumentState, to: DocumentState) {
    super(
      isTerminal(from)
        ? `${from} is terminal — nothing leaves it (attempted ${from} → ${to}).`
        : `No transition ${from} → ${to}. The lifecycle is deny-by-default: if it is not in the table, it cannot happen.`,
    );
    this.name = 'IllegalTransitionError';
  }
}

export class ReasonRequiredError extends Error {
  constructor(from: DocumentState, to: DocumentState) {
    super(`${from} → ${to} requires a reason.`);
    this.name = 'ReasonRequiredError';
  }
}

export class RoleNotPermittedError extends Error {
  constructor(role: string, from: DocumentState, to: DocumentState, why: string) {
    super(`Role ${role} may not perform ${from} → ${to}: ${why}`);
    this.name = 'RoleNotPermittedError';
  }
}

export class NoContentToFreezeError extends Error {
  constructor() {
    super('Cannot finalize a document with no upload attached — there would be nothing to freeze.');
    this.name = 'NoContentToFreezeError';
  }
}

/**
 * DC-06's gate again, at the other door.
 *
 * The scan gate stops a non-clean upload filling a slot. Freezing the same bytes
 * into a Final document would put them past the gate by another route, so
 * finalizing checks the scan state too. Only an explicit Clean passes — a scanner
 * error is not a pass, here as everywhere.
 */
export class ContentNotCleanError extends Error {
  constructor(scanState: string) {
    super(
      `Cannot finalize content that is ${scanState}. The scan gate admits an explicit Clean verdict only — ` +
        'an error, a missing scanner, or an unscanned upload is not a pass.',
    );
    this.name = 'ContentNotCleanError';
  }
}

interface Row {
  id: string; project_id: string; slot_code: string; title: string;
  state: DocumentState; state_since: Date; upload_id: string | null;
  content_hash: string | null; superseded_by: string | null;
}

const COLUMNS = 'id, project_id, slot_code, title, state, state_since, upload_id, content_hash, superseded_by';

const toDoc = (r: Row): Document => ({
  id: r.id, projectId: r.project_id, slotCode: r.slot_code, title: r.title,
  state: r.state, stateSince: r.state_since, uploadId: r.upload_id,
  contentHash: r.content_hash, supersededBy: r.superseded_by,
});

export class DocumentsRepository {
  private readonly audit: AuditRepository;

  constructor(private readonly pool: Pool) {
    this.audit = new AuditRepository(pool);
  }

  /**
   * Run `fn` inside a transaction, or join one already open.
   *
   * `supersede()` needs a new version and the retirement of the old one to happen
   * together or not at all — a half-applied supersede would leave an orphan Draft
   * in the register, counted as outstanding work that nobody asked for.
   */
  private async inTransaction<T>(client: PoolClient | undefined, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    if (client) return fn(client);
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const out = await fn(c);
      await c.query('commit');
      return out;
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }

  async create(
    input: { projectId: string; slotCode: string; title: string; uploadId?: string | null },
    actor: Actor,
    client?: PoolClient,
  ): Promise<Document> {
    return this.inTransaction(client, async (c) => {
      const { rows } = await c.query<Row>(
        `insert into documents (project_id, slot_code, title, upload_id, created_by, created_by_role)
         values ($1, $2, $3, $4, $5, $6) returning ${COLUMNS}`,
        [input.projectId, input.slotCode, input.title, input.uploadId ?? null, actor.id, actor.role],
      );
      const doc = toDoc(rows[0]);
      await c.query(
        `insert into document_transitions (document_id, from_state, to_state, actor_id, actor_role)
         values ($1, null, 'Draft', $2, $3)`,
        [doc.id, actor.id, actor.role],
      );
      await this.audit.append(
        { action: 'document.created', subjectType: 'document', subjectId: doc.id, detail: { slotCode: doc.slotCode } },
        actor,
        c,
      );
      return doc;
    });
  }

  async find(id: string, client?: PoolClient): Promise<Document | null> {
    const q = client ?? this.pool;
    const { rows } = await q.query<Row>(`select ${COLUMNS} from documents where id = $1`, [id]);
    return rows.length ? toDoc(rows[0]) : null;
  }

  /**
   * Move a document.
   *
   * Checks, in this order: the transition exists, the role may do it, a reason is
   * present when required, and there is content to freeze when required. Then it
   * writes everything in one transaction.
   */
  async transition(
    documentId: string,
    to: DocumentState,
    actor: Actor,
    options: { reason?: string | null } = {},
    client?: PoolClient,
  ): Promise<Document> {
    return this.inTransaction(client, async (c) => {
      // Lock the row: two concurrent transitions must not both read the old state.
      const { rows } = await c.query<Row>(`select ${COLUMNS} from documents where id = $1 for update`, [documentId]);
      if (!rows.length) throw new Error(`No document ${documentId}`);
      const doc = toDoc(rows[0]);

      const rule = findTransition(doc.state, to);
      if (!rule) throw new IllegalTransitionError(doc.state, to);

      const decision = resolve(actor.role, rule.capability, actor.authMode);
      if (!decision.permitted) throw new RoleNotPermittedError(actor.role, doc.state, to, decision.reason);

      if (rule.rolesAllowed && !rule.rolesAllowed.includes(actor.role)) {
        throw new RoleNotPermittedError(
          actor.role, doc.state, to,
          `restricted to ${rule.rolesAllowed.join(', ')} — ${rule.note}`,
        );
      }

      const reason = options.reason?.trim() || null;
      if (rule.requiresReason && !reason) throw new ReasonRequiredError(doc.state, to);

      let contentHash = doc.contentHash;
      if (rule.freezesContent) {
        const up = await c.query<{ sha256: string; scan_state: string }>(
          'select sha256, scan_state from uploads where id = $1',
          [doc.uploadId],
        );
        if (!up.rows.length) throw new NoContentToFreezeError();
        if (up.rows[0].scan_state !== 'Clean') throw new ContentNotCleanError(up.rows[0].scan_state);
        contentHash = up.rows[0].sha256;
      }

      // DC-08: the signature event, bound to the hash it approved.
      //
      // This is written BEFORE the state moves. The database trigger on
      // `approvals` asserts the document is Final, and Final is what it is at the
      // moment of approval — moving it to Signed first would make the row's own
      // enforcement see the state that approval produced rather than the state it
      // required, and the guard would refuse every legitimate signature.
      if (rule.isApproval) {
        await c.query(
          `insert into approvals (document_id, content_hash, approver_id, approver_role)
           values ($1, $2, $3, $4)`,
          [documentId, contentHash, actor.id, actor.role],
        );
      }

      const { rows: updated } = await c.query<Row>(
        `update documents set state = $2, state_since = now(), content_hash = $3
          where id = $1 returning ${COLUMNS}`,
        [documentId, to, contentHash],
      );

      await c.query(
        `insert into document_transitions (document_id, from_state, to_state, reason, content_hash, actor_id, actor_role)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [documentId, doc.state, to, reason, contentHash, actor.id, actor.role],
      );

      await this.audit.append(
        {
          action: `document.${to.toLowerCase().replace(/\s+/g, '-')}`,
          subjectType: 'document',
          subjectId: documentId,
          detail: { from: doc.state, to, reason, contentHash },
        },
        actor,
        c,
      );

      return toDoc(updated[0]);
    });
  }

  /**
   * Replace an approved document.
   *
   *   > Content is immutable at approval. Any later change is a new version,
   *   > which supersedes the approved one and returns the document to Draft.
   *
   * So the approved row is never edited: it becomes Superseded and a fresh Draft
   * carries the new content.
   */
  async supersede(
    documentId: string,
    newUploadId: string,
    reason: string,
    actor: Actor,
  ): Promise<{ superseded: Document; replacement: Document }> {
    if (!reason?.trim()) throw new ReasonRequiredError('Signed', 'Superseded');

    // One transaction: either the new version exists and the old one is retired
    // and linked to it, or nothing happened. Anything in between would leave an
    // orphan Draft that readiness counts as outstanding work.
    return this.inTransaction(undefined, async (c) => {
      const old = await this.find(documentId, c);
      if (!old) throw new Error(`No document ${documentId}`);

      const replacement = await this.create(
        { projectId: old.projectId, slotCode: old.slotCode, title: old.title, uploadId: newUploadId },
        actor,
        c,
      );
      const superseded = await this.transition(documentId, 'Superseded', actor, { reason }, c);
      await c.query('update documents set superseded_by = $2 where id = $1', [documentId, replacement.id]);

      return { superseded, replacement };
    });
  }

  /** Every document on a project, newest movement first. */
  async forProject(projectId: string): Promise<Document[]> {
    const { rows } = await this.pool.query<Row>(
      `select ${COLUMNS} from documents where project_id = $1 order by slot_code, state_since desc`,
      [projectId],
    );
    return rows.map(toDoc);
  }

  async history(documentId: string): Promise<DocumentTransition[]> {
    const { rows } = await this.pool.query<{
      from_state: DocumentState | null; to_state: DocumentState; reason: string | null;
      content_hash: string | null; actor_id: string; actor_role: string; occurred_at: Date;
    }>(
      `select from_state, to_state, reason, content_hash, actor_id, actor_role, occurred_at
         from document_transitions where document_id = $1 order by id`,
      [documentId],
    );
    return rows.map((r) => ({
      fromState: r.from_state, toState: r.to_state, reason: r.reason, contentHash: r.content_hash,
      actorId: r.actor_id, actorRole: r.actor_role, occurredAt: r.occurred_at,
    }));
  }

  /** Does the approval on record actually cover the content now attached? */
  async approvalCoversCurrentContent(documentId: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ ok: boolean }>(
      `select exists (
         select 1 from approvals a join documents d on d.id = a.document_id
          where a.document_id = $1 and a.content_hash = d.content_hash
       ) as ok`,
      [documentId],
    );
    return rows[0].ok;
  }
}
