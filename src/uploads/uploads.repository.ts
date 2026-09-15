/**
 * DC-06 — versioned uploads, gated on scanning.
 *
 * The flow: register an upload (Quarantined), the bytes go to storage, the
 * scanner runs, and only an explicit clean verdict moves it to Clean. Nothing
 * else does — not an error, not a missing scanner, not a timeout.
 */
import type { Pool } from 'pg';
import type { Actor } from '../operator/operator';
import type { Storage } from '../storage/storage';
import { sha256Of } from '../storage/storage';
import { passesGate, type Scanner } from '../scan/scanner';

export type ScanState = 'Quarantined' | 'Clean' | 'Infected' | 'ScanError';

export interface Upload {
  readonly id: string;
  readonly projectId: string;
  readonly slotCode: string;
  readonly version: number;
  readonly filename: string;
  readonly contentType: string | null;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly storageKey: string;
  readonly scanState: ScanState;
  readonly scanDetail: string | null;
  readonly scanner: string | null;
  readonly uploadedBy: string;
  readonly uploadedByRole: string;
}

interface Row {
  id: string; project_id: string; slot_code: string; version: number;
  filename: string; content_type: string | null; size_bytes: string;
  sha256: string; storage_key: string;
  scan_state: ScanState; scan_detail: string | null; scanner: string | null;
  uploaded_by: string; uploaded_by_role: string;
}

const COLUMNS =
  'id, project_id, slot_code, version, filename, content_type, size_bytes, sha256, storage_key, ' +
  'scan_state, scan_detail, scanner, uploaded_by, uploaded_by_role';

const toUpload = (r: Row): Upload => ({
  id: r.id, projectId: r.project_id, slotCode: r.slot_code, version: r.version,
  filename: r.filename, contentType: r.content_type, sizeBytes: Number(r.size_bytes),
  sha256: r.sha256, storageKey: r.storage_key,
  scanState: r.scan_state, scanDetail: r.scan_detail, scanner: r.scanner,
  uploadedBy: r.uploaded_by, uploadedByRole: r.uploaded_by_role,
});

export class SlotNotOnProjectError extends Error {
  constructor(projectId: string, slotCode: string) {
    super(`Project ${projectId} has no slot "${slotCode}"`);
    this.name = 'SlotNotOnProjectError';
  }
}

export class UploadsRepository {
  constructor(
    private readonly pool: Pool,
    private readonly storage: Storage,
    private readonly scanner: Scanner,
  ) {}

  /**
   * Store bytes and register them as the next version of a slot.
   *
   * Development path: in production the browser PUTs to a pre-signed URL and this
   * records what arrived. Either way the row starts Quarantined.
   */
  async upload(
    input: { projectId: string; slotCode: string; filename: string; contentType?: string | null; bytes: Buffer },
    actor: Actor,
  ): Promise<Upload> {
    const slot = await this.pool.query('select 1 from project_slots where project_id = $1 and slot_code = $2', [
      input.projectId,
      input.slotCode,
    ]);
    if (!slot.rowCount) throw new SlotNotOnProjectError(input.projectId, input.slotCode);

    const stored = await this.storage.put(input.bytes);
    const sha256 = sha256Of(input.bytes);

    const { rows } = await this.pool.query<Row>(
      `insert into uploads
         (project_id, slot_code, version, filename, content_type, size_bytes, sha256, storage_key,
          uploaded_by, uploaded_by_role)
       values ($1, $2,
         (select coalesce(max(version), 0) + 1 from uploads where project_id = $1 and slot_code = $2),
         $3, $4, $5, $6, $7, $8, $9)
       returning ${COLUMNS}`,
      [
        input.projectId, input.slotCode, input.filename, input.contentType ?? null,
        input.bytes.length, sha256, stored.key, actor.id, actor.role,
      ],
    );
    return toUpload(rows[0]);
  }

  /**
   * Run the scanner and record the verdict.
   *
   * Only an explicit clean verdict opens the gate. The state is written from the
   * verdict rather than defaulted, so a scanner that fails leaves the upload
   * exactly where it was: quarantined.
   */
  async scan(uploadId: string): Promise<Upload> {
    const { rows } = await this.pool.query<Row>(`select ${COLUMNS} from uploads where id = $1`, [uploadId]);
    if (!rows.length) throw new Error(`No upload ${uploadId}`);
    const upload = toUpload(rows[0]);

    const bytes = await this.storage.get(upload.storageKey);
    const result = await this.scanner.scan(bytes);

    const state: ScanState = passesGate(result)
      ? 'Clean'
      : result.verdict === 'infected'
        ? 'Infected'
        : 'ScanError';

    const { rows: updated } = await this.pool.query<Row>(
      `update uploads
          set scan_state = $2, scan_detail = $3, scanner = $4, scanned_at = $5
        where id = $1
        returning ${COLUMNS}`,
      [uploadId, state, result.detail, result.scanner, result.scannedAt],
    );
    return toUpload(updated[0]);
  }

  /** Mark the slot Filled. The database refuses unless a Clean upload exists. */
  async fillSlot(projectId: string, slotCode: string): Promise<void> {
    await this.pool.query(
      `update project_slots set state = 'Filled' where project_id = $1 and slot_code = $2`,
      [projectId, slotCode],
    );
  }

  async versions(projectId: string, slotCode: string): Promise<Upload[]> {
    const { rows } = await this.pool.query<Row>(
      `select ${COLUMNS} from uploads where project_id = $1 and slot_code = $2 order by version`,
      [projectId, slotCode],
    );
    return rows.map(toUpload);
  }

  async latest(projectId: string, slotCode: string): Promise<Upload | null> {
    const { rows } = await this.pool.query<Row>(
      `select ${COLUMNS} from uploads where project_id = $1 and slot_code = $2 order by version desc limit 1`,
      [projectId, slotCode],
    );
    return rows.length ? toUpload(rows[0]) : null;
  }
}
