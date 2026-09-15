/**
 * DC-07 / DC-08 — the lifecycle, and approval as the signature event.
 *
 * The rules proven here are the ones the settled decisions fix: only a Materials
 * Engineer finalizes, only the designated approver signs, approval is impossible
 * from any state but Final, rejection and voiding require reasons, age is per
 * state, and an approval is bound to the content hash it approved.
 *
 * These run with AUTH_MODE=password so the real role matrix is exercised. Under
 * AUTH_MODE=none every capability resolves permitted and the role tests would
 * pass without proving anything.
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
import { AuditRepository } from '../src/audit/audit.repository';
import {
  DocumentsRepository,
  IllegalTransitionError,
  ReasonRequiredError,
  RoleNotPermittedError,
  NoContentToFreezeError,
  ContentNotCleanError,
} from '../src/lifecycle/documents.repository';
import { TRANSITIONS, findTransition, isTerminal, countsAsDone, STATES } from '../src/lifecycle/states';
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

describe('the transition table', () => {
  it('never lets anything leave a terminal state', () => {
    for (const t of TRANSITIONS) expect(isTerminal(t.from)).toBe(false);
  });

  it('requires a reason wherever work is rejected or destroyed', () => {
    for (const t of TRANSITIONS.filter((x) => x.to === 'Void' || x.to === 'Superseded')) {
      expect(t.requiresReason).toBe(true);
    }
    expect(findTransition('In Review', 'Draft')!.requiresReason).toBe(true);
    expect(findTransition('Final', 'Draft')!.requiresReason).toBe(true);
  });

  it('allows approval only from Final, and only once in the whole table', () => {
    const approvals = TRANSITIONS.filter((t) => t.isApproval);
    expect(approvals).toHaveLength(1);
    expect(approvals[0].from).toBe('Final');
    expect(approvals[0].to).toBe('Signed');
  });

  it('freezes content on every route into Final, and nowhere else', () => {
    for (const t of TRANSITIONS) {
      expect(Boolean(t.freezesContent)).toBe(t.to === 'Final');
    }
  });

  it('counts Signed as done and Final as not — readiness counts Signed only', () => {
    expect(countsAsDone('Signed')).toBe(true);
    expect(countsAsDone('Final')).toBe(false);
    expect(countsAsDone('Draft')).toBe(false);
    expect(countsAsDone('In Review')).toBe(false);
  });

  it('has no transition naming a state the machine does not know', () => {
    for (const t of TRANSITIONS) {
      expect(STATES).toContain(t.from);
      expect(STATES).toContain(t.to);
    }
  });
});

/** Shared fixture: a project with one slot, and uploads with known scan states. */
async function fixture(pool: Pool, contractId: string, templateCode: string, dir: string) {
  const storage = new FilesystemStorage(dir);
  const projects = new ProjectsRepository(pool);
  const slots = new SlotsRepository(pool);
  const uploads = new UploadsRepository(pool, storage, cleanScanner);
  const SLOT = 'qcp';

  const t = await slots.createVersion(
    { code: templateCode, name: 'Lifecycle fixture', items: [{ slotCode: SLOT, name: 'QCP', required: true }] },
    as('admin'),
  );
  await slots.publish(t.id);
  const project = await projects.create({ contractId, name: 'Lifecycle fixture' }, as('admin'));
  await slots.instantiate(project.id, templateCode);

  const put = async (filename: string, body: string, scanIt = true) => {
    const u = await uploads.upload(
      { projectId: project.id, slotCode: SLOT, filename, bytes: Buffer.from(body) },
      as('admin'),
    );
    return scanIt ? (await uploads.scan(u.id)).id : u.id;
  };

  return {
    projectId: project.id,
    SLOT,
    cleanUpload: await put('a.pdf', `${contractId} first version`),
    revisedUpload: await put('b.pdf', `${contractId} revised version`),
    // deliberately never scanned — the gate must treat it as not-a-pass
    quarantinedUpload: await put('c.pdf', `${contractId} unscanned`, false),
  };
}

run('DC-07 lifecycle', () => {
  let pool: Pool;
  let dir: string;
  let docs: DocumentsRepository;
  let audit: AuditRepository;
  let f: Awaited<ReturnType<typeof fixture>>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await migrate(pool);
    await pool.query('truncate table documents, approvals, document_transitions cascade');
    await pool.query('truncate table uploads, project_slots cascade');
    await pool.query("delete from projects where contract_id like '26LC%'");
    await pool.query("delete from slot_templates where code = 'lc-set'");

    dir = await mkdtemp(path.join(os.tmpdir(), 'dpwh-lc-'));
    docs = new DocumentsRepository(pool);
    audit = new AuditRepository(pool);
    f = await fixture(pool, '26LC0001', 'lc-set', dir);
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  const newDoc = (uploadId: string | null = f.cleanUpload) =>
    docs.create({ projectId: f.projectId, slotCode: f.SLOT, title: 'QCP', uploadId }, as('materials_engineer'));

  it('starts in Draft and records that as its first transition', async () => {
    const d = await newDoc();
    expect(d.state).toBe('Draft');
    const h = await docs.history(d.id);
    expect(h).toHaveLength(1);
    expect(h[0].fromState).toBeNull();
    expect(h[0].toState).toBe('Draft');
  });

  it('refuses a transition that is not in the table', async () => {
    const d = await newDoc();
    await expect(docs.transition(d.id, 'Signed', as('approver'))).rejects.toBeInstanceOf(IllegalTransitionError);
    await expect(docs.transition(d.id, 'Archived', as('admin'))).rejects.toBeInstanceOf(IllegalTransitionError);
  });

  it('lets only a Materials Engineer finalize', async () => {
    const d = await newDoc();
    await expect(docs.transition(d.id, 'Final', as('project_engineer'))).rejects.toBeInstanceOf(RoleNotPermittedError);
    await expect(docs.transition(d.id, 'Final', as('viewer'))).rejects.toBeInstanceOf(RoleNotPermittedError);
    expect((await docs.transition(d.id, 'Final', as('materials_engineer'))).state).toBe('Final');
  });

  it('freezes the content hash when finalizing', async () => {
    const d = await newDoc();
    expect(d.contentHash).toBeNull();
    const final = await docs.transition(d.id, 'Final', as('materials_engineer'));
    expect(final.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses to finalize a document with nothing attached', async () => {
    const d = await newDoc(null);
    await expect(docs.transition(d.id, 'Final', as('materials_engineer'))).rejects.toBeInstanceOf(NoContentToFreezeError);
  });

  it('refuses to freeze content the scan gate never passed', async () => {
    const d = await newDoc(f.quarantinedUpload);
    await expect(docs.transition(d.id, 'Final', as('materials_engineer'))).rejects.toBeInstanceOf(ContentNotCleanError);
  });

  it('refuses to freeze unscanned content at the database too', async () => {
    const d = await newDoc(f.quarantinedUpload);
    await expect(
      pool.query("update documents set state = 'Final', content_hash = $2 where id = $1", [d.id, 'a'.repeat(64)]),
    ).rejects.toThrow(/cannot freeze content/i);
  });

  it('requires a reason to reject', async () => {
    const d = await newDoc();
    await docs.transition(d.id, 'Final', as('materials_engineer'));
    await expect(docs.transition(d.id, 'Draft', as('approver'))).rejects.toBeInstanceOf(ReasonRequiredError);
    await expect(docs.transition(d.id, 'Draft', as('approver'), { reason: '   ' })).rejects.toBeInstanceOf(
      ReasonRequiredError,
    );
    expect((await docs.transition(d.id, 'Draft', as('approver'), { reason: 'Missing test results' })).state).toBe(
      'Draft',
    );
  });

  it('requires a reason and an approver to void', async () => {
    const d = await newDoc();
    await expect(docs.transition(d.id, 'Void', as('materials_engineer'), { reason: 'x' })).rejects.toBeInstanceOf(
      RoleNotPermittedError,
    );
    await expect(docs.transition(d.id, 'Void', as('approver'))).rejects.toBeInstanceOf(ReasonRequiredError);
    expect((await docs.transition(d.id, 'Void', as('approver'), { reason: 'Wrong contract' })).state).toBe('Void');
  });

  it('lets nothing leave a terminal state', async () => {
    const d = await newDoc();
    await docs.transition(d.id, 'Void', as('approver'), { reason: 'issued in error' });
    await expect(docs.transition(d.id, 'Draft', as('admin'))).rejects.toBeInstanceOf(IllegalTransitionError);
  });

  it('resets the per-state clock on every transition, never ageing from creation', async () => {
    const d = await newDoc();
    const created = d.stateSince;
    await new Promise((r) => setTimeout(r, 1100));
    const review = await docs.transition(d.id, 'In Review', as('materials_engineer'));
    expect(review.stateSince.getTime()).toBeGreaterThan(created.getTime());
  }, 20_000);

  it('records every transition, append-only', async () => {
    const d = await newDoc();
    await docs.transition(d.id, 'In Review', as('materials_engineer'));
    expect((await docs.history(d.id)).map((x) => x.toState)).toEqual(['Draft', 'In Review']);
    await expect(
      pool.query("update document_transitions set to_state = 'Signed' where document_id = $1", [d.id]),
    ).rejects.toThrow(/append-only/i);
    await expect(pool.query('delete from document_transitions where document_id = $1', [d.id])).rejects.toThrow(
      /append-only/i,
    );
  });

  it('records the reason on the transition itself, not only in the audit trail', async () => {
    const d = await newDoc();
    await docs.transition(d.id, 'Final', as('materials_engineer'));
    await docs.transition(d.id, 'Draft', as('approver'), { reason: 'Sieve analysis missing' });
    const h = await docs.history(d.id);
    expect(h[h.length - 1].reason).toBe('Sieve analysis missing');
  });

  it('writes an audit event for each transition, and the chain stays whole', async () => {
    const d = await newDoc();
    await docs.transition(d.id, 'Final', as('materials_engineer'));
    const events = await audit.forSubject('document', d.id);
    expect(events.map((e) => e.action)).toEqual(['document.created', 'document.final']);
    expect((await audit.verifyChain()).ok).toBe(true);
  });

  it('leaves nothing behind when a transition is refused', async () => {
    const d = await newDoc();
    const before = (await docs.history(d.id)).length;
    await expect(docs.transition(d.id, 'Final', as('viewer'))).rejects.toBeInstanceOf(RoleNotPermittedError);
    expect((await docs.history(d.id)).length).toBe(before);
    expect((await docs.find(d.id))!.state).toBe('Draft');
  });
});

run('DC-08 approval as the signature event', () => {
  let pool: Pool;
  let dir: string;
  let docs: DocumentsRepository;
  let f: Awaited<ReturnType<typeof fixture>>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await migrate(pool);
    await pool.query('truncate table documents, approvals, document_transitions cascade');
    await pool.query('truncate table uploads, project_slots cascade');
    await pool.query("delete from projects where contract_id like '26AP%'");
    await pool.query("delete from slot_templates where code = 'ap-set'");

    dir = await mkdtemp(path.join(os.tmpdir(), 'dpwh-ap-'));
    docs = new DocumentsRepository(pool);
    f = await fixture(pool, '26AP0001', 'ap-set', dir);
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  const finalDoc = async () => {
    const d = await docs.create(
      { projectId: f.projectId, slotCode: f.SLOT, title: 'QCP', uploadId: f.cleanUpload },
      as('materials_engineer'),
    );
    return docs.transition(d.id, 'Final', as('materials_engineer'));
  };

  it('lets only the designated approver sign', async () => {
    const d = await finalDoc();
    await expect(docs.transition(d.id, 'Signed', as('materials_engineer'))).rejects.toBeInstanceOf(
      RoleNotPermittedError,
    );
    await expect(docs.transition(d.id, 'Signed', as('project_engineer'))).rejects.toBeInstanceOf(RoleNotPermittedError);
    expect((await docs.transition(d.id, 'Signed', as('approver'))).state).toBe('Signed');
  });

  it('binds the approval to the content hash it approved', async () => {
    const d = await finalDoc();
    const signed = await docs.transition(d.id, 'Signed', as('approver'));
    const { rows } = await pool.query<{ content_hash: string; approver_role: string }>(
      'select content_hash, approver_role from approvals where document_id = $1',
      [d.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].content_hash).toBe(signed.contentHash);
    expect(rows[0].approver_role).toBe('approver');
    expect(await docs.approvalCoversCurrentContent(d.id)).toBe(true);
  });

  it('refuses approval from any state but Final — at the database, whatever the caller believes', async () => {
    const d = await docs.create(
      { projectId: f.projectId, slotCode: f.SLOT, title: 'Draft doc', uploadId: f.cleanUpload },
      as('materials_engineer'),
    );
    await expect(
      pool.query(
        'insert into approvals (document_id, content_hash, approver_id, approver_role) values ($1, $2, $3, $4)',
        [d.id, 'a'.repeat(64), 'operator:single', 'approver'],
      ),
    ).rejects.toThrow(/requires the document to be Final/i);
  });

  it('records one approval per version, not one per attempt', async () => {
    const d = await finalDoc();
    const approve = () =>
      pool.query(
        'insert into approvals (document_id, content_hash, approver_id, approver_role) values ($1, $2, $3, $4)',
        [d.id, d.contentHash, 'operator:single', 'approver'],
      );
    await approve();
    await expect(approve()).rejects.toThrow(/duplicate key|approvals_one_per_version/i);
  });

  /**
   * "Content is immutable at approval. Any later change is a new version, which
   * supersedes the approved one and returns the document to Draft."
   */
  it('supersedes rather than editing an approved document', async () => {
    const d = await finalDoc();
    await docs.transition(d.id, 'Signed', as('approver'));
    const approvedHash = (await docs.find(d.id))!.contentHash;

    const { superseded, replacement } = await docs.supersede(
      d.id,
      f.revisedUpload,
      'Revised after review',
      as('admin'),
    );

    expect(superseded.state).toBe('Superseded');
    expect(superseded.contentHash).toBe(approvedHash); // the approved bytes are untouched
    expect(replacement.state).toBe('Draft'); // the new version starts over
    expect(replacement.id).not.toBe(d.id);
    expect(replacement.uploadId).toBe(f.revisedUpload);

    const { rows } = await pool.query<{ superseded_by: string }>(
      'select superseded_by from documents where id = $1',
      [d.id],
    );
    expect(rows[0].superseded_by).toBe(replacement.id);

    // the approval that was made still stands against the version it approved
    const ap = await pool.query('select 1 from approvals where document_id = $1 and content_hash = $2', [
      d.id,
      approvedHash,
    ]);
    expect(ap.rowCount).toBe(1);
  });

  it('refuses to supersede without a reason, and creates no orphan draft when it refuses', async () => {
    const d = await finalDoc();
    await docs.transition(d.id, 'Signed', as('approver'));
    const before = await pool.query<{ n: number }>('select count(*)::int as n from documents');
    await expect(docs.supersede(d.id, f.revisedUpload, '  ', as('admin'))).rejects.toBeInstanceOf(ReasonRequiredError);
    const after = await pool.query<{ n: number }>('select count(*)::int as n from documents');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  /**
   * A supersede that fails partway would leave a new Draft with nothing retired
   * behind it — outstanding work in the register that nobody created on purpose.
   * Forced here by superseding a Draft, which has no route to Superseded, so the
   * failure happens after the replacement would have been written.
   */
  it('creates no orphan draft when the supersede itself fails', async () => {
    const d = await docs.create(
      { projectId: f.projectId, slotCode: f.SLOT, title: 'Never superseded', uploadId: f.cleanUpload },
      as('materials_engineer'),
    );
    const before = await pool.query<{ n: number }>('select count(*)::int as n from documents');
    await expect(docs.supersede(d.id, f.revisedUpload, 'a real reason', as('admin'))).rejects.toBeInstanceOf(
      IllegalTransitionError,
    );
    const after = await pool.query<{ n: number }>('select count(*)::int as n from documents');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('shows an approval no longer covering content that changed underneath it', async () => {
    const d = await finalDoc();
    await docs.transition(d.id, 'Signed', as('approver'));
    expect(await docs.approvalCoversCurrentContent(d.id)).toBe(true);

    // drift that bypassed the lifecycle entirely
    await pool.query('update documents set content_hash = $2 where id = $1', [d.id, 'b'.repeat(64)]);
    expect(await docs.approvalCoversCurrentContent(d.id)).toBe(false);
  });

  it('archives a signed document', async () => {
    const d = await finalDoc();
    await docs.transition(d.id, 'Signed', as('approver'));
    expect((await docs.transition(d.id, 'Archived', as('admin'))).state).toBe('Archived');
  });
});
