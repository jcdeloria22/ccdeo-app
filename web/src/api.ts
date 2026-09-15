/**
 * The API, typed once.
 *
 * These types mirror what the controller returns. They are hand-written rather
 * than generated because there is one consumer and a generator would be a second
 * build step to maintain — but they live in one file, so when the API changes
 * there is exactly one place the compiler will point at.
 */

export type ReminderLevel = 'warning' | 'overdue';

export type DocumentState = 'Draft' | 'In Review' | 'Final' | 'Signed' | 'Archived' | 'Superseded' | 'Void';

export interface InboxItem {
  reminderId: string;
  documentId: string;
  projectId: string;
  contractId: string;
  slotCode: string;
  title: string;
  state: DocumentState;
  level: ReminderLevel;
  ageDays: number;
  reason: string;
  raisedAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}

export interface InboxCounts {
  unread: number;
  unreadOverdue: number;
  unreadWarning: number;
  total: number;
}

export interface InboxResponse {
  items: InboxItem[];
  counts: InboxCounts;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /**
     * The server's machine-readable code, where it sends one.
     *
     * Only `password_change_required` so far. The screen has to route on it —
     * matching the prose of a message would break the moment the wording is
     * improved.
     */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Announced when the server says the caller is not signed in.
 *
 * A session can expire while a screen is open, and every view would otherwise
 * have to know how to recover. Instead the session gate listens for this and
 * re-checks once; views keep showing their own error and are replaced.
 */
export const AUTH_EXPIRED = 'dpwh:auth-expired';

/**
 * One fetch wrapper, so every call fails the same way.
 *
 * A non-2xx is an error, not an empty result. The alternative — returning `[]`
 * on failure — renders an empty inbox that looks exactly like "nothing needs
 * you", which is the worst possible lie for this particular screen.
 */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { headers: { accept: 'application/json' }, ...init });
  } catch (e) {
    throw new ApiError(0, `Could not reach the server. Is it running on 127.0.0.1:3000? (${(e as Error).message})`);
  }

  if (!res.ok) {
    let detail = res.statusText;
    let code: string | undefined;
    try {
      const body = (await res.json()) as { message?: string | string[]; code?: string };
      if (body.message) detail = Array.isArray(body.message) ? body.message.join('; ') : body.message;
      code = body.code;
    } catch {
      /* not JSON; the status text will do */
    }

    /*
     * A 401 anywhere means the session is gone — expired, revoked, or never
     * there. Said once, here, rather than handled in every view. `/auth/me` is
     * excluded because the gate calls it precisely to find out, and it would
     * otherwise announce the thing it was asking about.
     */
    if (res.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED));
    }

    throw new ApiError(res.status, detail, code);
  }

  return (await res.json()) as T;
}

/** Every write sends JSON; naming it once keeps the calls below readable. */
const JSON_HEADERS = { 'content-type': 'application/json' };

const qs = (params: Record<string, string | boolean | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  inbox: (opts: { projectId?: string; unread?: boolean } = {}): Promise<InboxResponse> =>
    call<InboxResponse>(`/reminders${qs({ projectId: opts.projectId, unread: opts.unread })}`),

  counts: (projectId?: string): Promise<InboxCounts> => call<InboxCounts>(`/reminders/counts${qs({ projectId })}`),

  acknowledge: (id: string): Promise<{ newlyAcknowledged: boolean; item: InboxItem }> =>
    call(`/reminders/${id}/acknowledge`, { method: 'POST' }),

  acknowledgeAll: (projectId?: string): Promise<{ acknowledged: number; counts: InboxCounts }> =>
    call(`/reminders/acknowledge-all${qs({ projectId })}`, { method: 'POST' }),
};

/* ---------- the register ---------- */

export type SlotState = 'Pending' | 'Filled' | 'Waived';

export interface Project {
  id: string;
  contractId: string;
  name: string;
}

export interface Readiness {
  requiredTotal: number;
  signed: number;
  waived: number;
  closedOut: number;
  awaitingApproval: number;
  inProgress: number;
  empty: number;
  optionalTotal: number;
  optionalSigned: number;
  ratio: number | null;
  percent: number | null;
  complete: boolean;
}

export type SlotOutcome = 'signed' | 'awaiting-approval' | 'in-progress' | 'waived' | 'empty';

export interface SlotReadiness {
  slotCode: string;
  required: boolean;
  outcome: SlotOutcome;
}

export interface ProjectReadiness {
  projectId: string;
  contractId: string;
  name: string;
  readiness: Readiness;
  slots: SlotReadiness[];
}

export interface ProjectSlot {
  slotCode: string;
  name: string;
  required: boolean;
  state: SlotState;
  waivedReason: string | null;
}

export interface Doc {
  id: string;
  slotCode: string;
  title: string;
  state: DocumentState;
  stateSince: string;
  contentHash: string | null;
  supersededBy: string | null;
}

export interface ApprovalDebtItem {
  documentId: string;
  projectId: string;
  contractId: string;
  slotCode: string;
  title: string;
  since: string;
}

/* ---------- audit ---------- */

export interface AuditEvent {
  id: string;
  occurredAt: string;
  actorId: string;
  actorRole: string;
  action: string;
  subjectType: string;
  subjectId: string | null;
  detail: Record<string, unknown>;
  prevHash: string | null;
  hash: string;
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  brokenAt: string | null;
  reason: string | null;
}

export const registerApi = {
  list: (): Promise<{ rows: { project: Project; readiness: Readiness | null }[]; total: number }> =>
    call('/projects'),

  detail: (
    id: string,
  ): Promise<{ project: Project; readiness: ProjectReadiness | null; slots: ProjectSlot[]; documents: Doc[] }> =>
    call(`/projects/${id}`),
};

export const readinessApi = {
  portfolio: (): Promise<{ projects: ProjectReadiness[] }> => call('/readiness'),
  debt: (projectId?: string): Promise<{ items: ApprovalDebtItem[] }> =>
    call(`/readiness/debt${qs({ projectId })}`),
};

export const auditApi = {
  list: (): Promise<{ events: AuditEvent[] }> => call('/audit'),
  verify: (): Promise<ChainVerification> => call('/audit/verify'),
};

/* ---------- writing ---------- */

export interface SlotTemplate {
  id: string;
  code: string;
  version: number;
  name: string;
  status: 'draft' | 'active' | 'superseded';
  provisional: boolean;
  sourceNote: string;
}

export interface SlotTemplateItem {
  slotCode: string;
  name: string;
  required: boolean;
  position: number;
}

export interface Upload {
  id: string;
  version: number;
  filename: string;
  sha256: string;
  scanState: 'Quarantined' | 'Clean' | 'Infected' | 'ScanError';
  scanDetail: string | null;
}

/** SHA-256 of a file, in the browser. The key a blob is stored under is its hash. */
export async function hashFile(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const templatesApi = {
  active: (code: string): Promise<{ template: SlotTemplate | null; items: SlotTemplateItem[] }> =>
    call(`/slot-templates/${encodeURIComponent(code)}`),

  create: (body: {
    code: string;
    name: string;
    items: { slotCode: string; name: string; required: boolean }[];
  }): Promise<{ template: SlotTemplate }> =>
    call('/slot-templates', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }),

  publish: (id: string): Promise<{ template: SlotTemplate }> =>
    call(`/slot-templates/${id}/publish`, { method: 'POST' }),
};

export const writeApi = {
  createProject: (body: { contractId: string; name: string; location?: string }): Promise<{ project: Project }> =>
    call('/projects', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }),

  assignSlots: (projectId: string, templateCode: string): Promise<{ slots: ProjectSlot[] }> =>
    call(`/projects/${projectId}/slots`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ templateCode }),
    }),

  waive: (projectId: string, slotCode: string, reason: string): Promise<{ slot: ProjectSlot }> =>
    call(`/projects/${projectId}/slots/${encodeURIComponent(slotCode)}/waive`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ reason }),
    }),

  createDocument: (body: {
    projectId: string;
    slotCode: string;
    title: string;
    uploadId?: string | null;
  }): Promise<{ document: Doc }> =>
    call('/documents', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }),

  transition: (documentId: string, to: DocumentState, reason?: string): Promise<{ document: Doc }> =>
    call(`/documents/${documentId}/transition`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ to, reason: reason ?? null }),
    }),

  runReminders: (): Promise<{ raised: number; counts: InboxCounts }> =>
    call('/reminders/run', { method: 'POST' }),
};

/**
 * Put a file in a slot.
 *
 * Four steps, because the API never handles the bytes: ask where they go, PUT
 * them there, say what arrived, then scan. Exposed as one call so a screen does
 * not have to know that — but the steps are reported as they happen, since on a
 * slow scan the difference between "uploading" and "scanning" is the difference
 * between waiting and worrying.
 */
export async function uploadToSlot(
  projectId: string,
  slotCode: string,
  file: File,
  onStep?: (step: 'hashing' | 'uploading' | 'registering' | 'scanning') => void,
): Promise<Upload> {
  onStep?.('hashing');
  const sha256 = await hashFile(file);

  onStep?.('uploading');
  const base = `/projects/${projectId}/slots/${encodeURIComponent(slotCode)}/uploads`;
  const { url } = await call<{ url: string; key: string }>(`${base}/presign`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ sha256 }),
  });

  const put = await fetch(url, { method: 'PUT', body: file });
  if (!put.ok) throw new ApiError(put.status, `Could not store the file (${put.statusText})`);

  onStep?.('registering');
  const { upload } = await call<{ upload: Upload }>(`${base}/register`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ sha256, filename: file.name, contentType: file.type || null }),
  });

  onStep?.('scanning');
  const scanned = await call<{ upload: Upload }>(`${base}/${upload.id}/scan`, { method: 'POST' });
  return scanned.upload;
}

/* ---------- the lifecycle, described by the server ---------- */

export interface Transition {
  from: DocumentState;
  to: DocumentState;
  capability: string;
  requiresReason: boolean;
  freezesContent?: boolean;
  isApproval?: boolean;
  rolesAllowed?: string[];
  note: string;
}

export interface LifecycleDescription {
  states: DocumentState[];
  terminal: DocumentState[];
  mainLine: DocumentState[];
  transitions: Transition[];
}

export const lifecycleApi = {
  describe: (): Promise<LifecycleDescription> => call('/lifecycle'),
};

/* ---------- office reference data ---------- */

export interface Signatories {
  chair: string;
  vice: string;
  de: string;
  so: string;
}

export interface Setting<T = unknown> {
  key: string;
  value: T;
  updatedAt: string;
  updatedBy: string;
  updatedByRole: string;
}

export const settingsApi = {
  get: <T,>(key: string): Promise<{ setting: Setting<T> | null }> =>
    call(`/settings/${encodeURIComponent(key)}`),

  put: <T,>(key: string, value: T): Promise<{ setting: Setting<T> }> =>
    call(`/settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ value }),
    }),
};

/* ---------- study progress ---------- */

export interface QuizProgress {
  bank: 'me' | 'pe';
  state: Record<string, unknown>;
  updatedAt: string;
}

export interface Provenance {
  sourceDocument: string;
  sourceSection: string;
  sourceYear: number;
  tier: number;
  /** How the row was checked — an extraction method, or who checked it. */
  verifiedBy: string;
  verifiedOn: string;
  caveat?: string;
  /** Who took responsibility for it. Absent until someone has signed it off. */
  countersignedBy?: string;
  countersignedOn?: string;
}

export interface TestingRule {
  id: string;
  item: string;
  test: string;
  frequency: string;
  perQuantity: number | null;
  basisUnit: string;
  provenance: Provenance;
  acceptance?: { requirement: string; provenance: Provenance };
}

export interface QcpRules {
  version: string;
  items: string[];
  rules: TestingRule[];
}

export type StudyRecord = 'me' | 'pe' | 'workflow';

/**
 * The generator's verified rules, read-only.
 *
 * Fetched rather than copied into the frontend: the ME Workflow's study tables
 * are tier 0 and one of their notes is out of date, and the fix for that is to
 * show the verified record beside them — not to write the same specification
 * value into a second place.
 */
export type AuthMode = 'none' | 'password';

export interface SignedInUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface WhoAmI {
  user: SignedInUser;
  mustChangePassword: boolean;
  authMode: AuthMode;
}

/**
 * Signing in and out.
 *
 * `mode` is the only call made before anything is known — it says whether this
 * build uses passwords at all, so a loopback single-operator build never renders
 * a login screen it has no accounts for.
 */
export const authApi = {
  mode: (): Promise<{ authMode: AuthMode }> => call('/auth/mode'),

  me: (): Promise<WhoAmI> => call('/auth/me'),

  login: (email: string, password: string): Promise<{ user: SignedInUser; mustChangePassword: boolean }> =>
    call('/auth/login', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ email, password }) }),

  logout: (): Promise<{ ok: true }> => call('/auth/logout', { method: 'POST' }),

  changePassword: (currentPassword: string, newPassword: string): Promise<{ ok: true }> =>
    call('/auth/change-password', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
};

export const qcpApi = {
  rules: (): Promise<QcpRules> => call('/generators/qcp/rules'),
};

export const quizApi = {
  get: (bank: StudyRecord): Promise<{ progress: QuizProgress | null }> => call(`/quiz/${bank}`),

  put: (bank: StudyRecord, state: Record<string, unknown>): Promise<{ progress: QuizProgress }> =>
    call(`/quiz/${bank}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ state }) }),

  clear: (bank: StudyRecord): Promise<{ cleared: boolean }> => call(`/quiz/${bank}`, { method: 'DELETE' }),
};
