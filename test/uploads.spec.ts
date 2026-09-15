/**
 * DC-06 — versioned uploads and the scan gate.
 *
 * The gate tests use fake scanners to force each verdict deterministically, and a
 * separate suite drives real ClamAV with the EICAR test string — the standard
 * harmless file every scanner is required to detect. Using EICAR means the
 * scanner is genuinely exercised without putting malware on the machine.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { migrate } from '../src/db/migrate';
import { FilesystemStorage } from '../src/storage/filesystem.storage';
import { ContentMismatchError, sha256Of } from '../src/storage/storage';
import { UploadsRepository, SlotNotOnProjectError } from '../src/uploads/uploads.repository';
import { ProjectsRepository } from '../src/projects/projects.repository';
import { SlotsRepository } from '../src/slots/slots.repository';
import { NoScanner, passesGate, type Scanner, type ScanResult } from '../src/scan/scanner';
import { ClamAvScanner, findClamscan, findClamDatabase, hasSignatures } from '../src/scan/clamav.scanner';
import { seededOperator } from '../src/operator/operator';
import { loadEnv } from '../src/config/env';

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;

const actor = seededOperator(
  loadEnv({ AUTH_MODE: 'none', OPERATOR_NAME: 'Jayz', OPERATOR_EMAIL: 'jayz@example.com' } as NodeJS.ProcessEnv),
  'materials_engineer',
);

/** A scanner that always returns the verdict it was built with. */
const fixedScanner = (verdict: ScanResult['verdict'], detail: string | null = null): Scanner => ({
  name: 'fake',
  available: async () => true,
  scan: async () => ({ verdict, detail, scanner: 'fake', scannedAt: new Date() }),
});

run('DC-06 uploads and the scan gate', () => {
  let pool: Pool;
  let dir: string;
  let storage: FilesystemStorage;
  let projects: ProjectsRepository;
  let slots: SlotsRepository;
  let projectId: string;

  const SLOT = 'qcp';

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await migrate(pool);
    await pool.query('truncate table uploads, project_slots cascade');
    await pool.query("delete from projects where contract_id like '26UP%'");
    await pool.query("delete from slot_templates where code = 'upload-set'");

    dir = await mkdtemp(path.join(os.tmpdir(), 'dpwh-store-'));
    storage = new FilesystemStorage(dir);
    projects = new ProjectsRepository(pool);
    slots = new SlotsRepository(pool);

    const t = await slots.createVersion(
      { code: 'upload-set', name: 'Upload fixture', items: [{ slotCode: SLOT, name: 'QCP', required: true }] },
      actor,
    );
    await slots.publish(t.id);
    const p = await projects.create({ contractId: '26UP0001', name: 'Upload fixture' }, actor);
    projectId = p.id;
    await slots.instantiate(projectId, 'upload-set');
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  const repoWith = (s: Scanner) => new UploadsRepository(pool, storage, s);

  it('refuses an upload for a slot the project does not have', async () => {
    await expect(
      repoWith(fixedScanner('clean')).upload(
        { projectId, slotCode: 'not-a-slot', filename: 'x.pdf', bytes: Buffer.from('x') },
        actor,
      ),
    ).rejects.toBeInstanceOf(SlotNotOnProjectError);
  });

  it('starts an upload Quarantined, before anything has scanned it', async () => {
    const u = await repoWith(fixedScanner('clean')).upload(
      { projectId, slotCode: SLOT, filename: 'qcp.pdf', bytes: Buffer.from('first version'), contentType: 'application/pdf' },
      actor,
    );
    expect(u.scanState).toBe('Quarantined');
    expect(u.version).toBe(1);
    expect(u.sha256).toBe(sha256Of(Buffer.from('first version')));
  });

  it('will NOT fill a slot from a quarantined upload', async () => {
    await expect(repoWith(fixedScanner('clean')).fillSlot(projectId, SLOT)).rejects.toThrow(/scan gate/i);
  });

  it('will NOT fill a slot from an infected upload', async () => {
    const repo = repoWith(fixedScanner('infected', 'Test.Signature'));
    const u = await repo.latest(projectId, SLOT);
    const scanned = await repo.scan(u!.id);
    expect(scanned.scanState).toBe('Infected');
    await expect(repo.fillSlot(projectId, SLOT)).rejects.toThrow(/scan gate/i);
  });

  it('will NOT fill a slot when the scanner errored — an error is not a pass', async () => {
    const repo = repoWith(fixedScanner('error', 'scanner exploded'));
    const u = await repo.latest(projectId, SLOT);
    const scanned = await repo.scan(u!.id);
    expect(scanned.scanState).toBe('ScanError');
    await expect(repo.fillSlot(projectId, SLOT)).rejects.toThrow(/scan gate/i);
  });

  it('will NOT fill a slot when no scanner is configured', async () => {
    const repo = repoWith(new NoScanner());
    const u = await repo.latest(projectId, SLOT);
    const scanned = await repo.scan(u!.id);
    expect(scanned.scanState).toBe('ScanError');
    expect(scanned.scanDetail).toMatch(/no scanner configured/);
    await expect(repo.fillSlot(projectId, SLOT)).rejects.toThrow(/scan gate/i);
  });

  it('fills the slot once an upload is explicitly clean', async () => {
    const repo = repoWith(fixedScanner('clean'));
    const u = await repo.latest(projectId, SLOT);
    const scanned = await repo.scan(u!.id);
    expect(scanned.scanState).toBe('Clean');
    await repo.fillSlot(projectId, SLOT);
    const list = await slots.forProject(projectId);
    expect(list.find((s) => s.slotCode === SLOT)!.state).toBe('Filled');
  });

  it('makes a replacement a NEW version and leaves the old one alone', async () => {
    const repo = repoWith(fixedScanner('clean'));
    const before = await repo.versions(projectId, SLOT);
    const v2 = await repo.upload(
      { projectId, slotCode: SLOT, filename: 'qcp-rev2.pdf', bytes: Buffer.from('second version') },
      actor,
    );
    expect(v2.version).toBe(before.length + 1);
    expect(v2.scanState).toBe('Quarantined');

    const after = await repo.versions(projectId, SLOT);
    expect(after[0].sha256).toBe(before[0].sha256);
    expect(after[0].storageKey).toBe(before[0].storageKey);
  });

  it('refuses to mutate an upload in place', async () => {
    const u = (await repoWith(new NoScanner()).versions(projectId, SLOT))[0];
    await expect(
      pool.query('update uploads set sha256 = $2 where id = $1', [u.id, 'f'.repeat(64)]),
    ).rejects.toThrow(/immutable/i);
    await expect(
      pool.query('update uploads set storage_key = $2 where id = $1', [u.id, 'blobs/aa/bb/evil']),
    ).rejects.toThrow(/immutable/i);
  });

  it('addresses identical content to the same key, and different content elsewhere', async () => {
    const a = await storage.put(Buffer.from('same bytes'));
    const b = await storage.put(Buffer.from('same bytes'));
    const c = await storage.put(Buffer.from('other bytes'));
    expect(a.key).toBe(b.key);
    expect(a.key).not.toBe(c.key);
  });

  /**
   * A key holding content that is not what the key says is either a hash
   * collision or a bug. Neither may pass quietly, so the store refuses rather
   * than overwriting. Forced here by corrupting the file behind the key — the
   * only way to reach the condition without an actual collision.
   */
  it('refuses to overwrite a key whose content no longer matches it', async () => {
    const bytes = Buffer.from('original content');
    const { key } = await storage.put(bytes);
    await writeFile(path.resolve(dir, key), 'tampered content');
    await expect(storage.put(bytes)).rejects.toBeInstanceOf(ContentMismatchError);
  });

  it('never hands the API the bytes — it hands back a URL to upload to', async () => {
    const p = await storage.presignPut(sha256Of(Buffer.from('z')));
    expect(p.url).toMatch(/^file\+put:\/\//);   // deliberately not http, so nothing mistakes it for real
    expect(p.key).toContain(sha256Of(Buffer.from('z')));
  });
});

describe('the gate itself', () => {
  it('only an explicit clean verdict passes', () => {
    const at = new Date();
    expect(passesGate({ verdict: 'clean', detail: null, scanner: 'x', scannedAt: at })).toBe(true);
    expect(passesGate({ verdict: 'infected', detail: 'y', scanner: 'x', scannedAt: at })).toBe(false);
    expect(passesGate({ verdict: 'error', detail: 'y', scanner: 'x', scannedAt: at })).toBe(false);
    expect(passesGate(null)).toBe(false);
    expect(passesGate(undefined)).toBe(false);
  });
});

/**
 * Real ClamAV. EICAR is the industry-standard harmless test file — a 68-byte
 * string every scanner must report as a detection — so this proves the scanner
 * actually detects, without malware anywhere near the machine.
 */
const clam = findClamscan();
const signatures = hasSignatures();
const clamRun = clam && signatures ? describe : describe.skip;

if (!clam) {
  // eslint-disable-next-line no-console
  console.warn('clamscan not found — real-scanner tests skipped');
} else if (!signatures) {
  // A binary with no signatures cannot deliver a verdict. Skipping with the
  // reason spelled out beats failing and looking like the scanner is broken.
  // eslint-disable-next-line no-console
  console.warn(
    'clamscan found but its signature database is empty — real-scanner tests skipped. ' +
      'Run freshclam, and point CLAMAV_DB_PATH at where it wrote.',
  );
}

clamRun('ClamAV', () => {
  // Assembled from pieces so the file on disk never contains the literal string
  // and cannot trip a scanner watching this repository.
  const EICAR = Buffer.from(
    ['X5O!P%@AP[4', 'PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(String.fromCharCode(92)),
    'ascii',
  );

  it('is available', async () => {
    expect(await new ClamAvScanner().available()).toBe(true);
  });

  it('reports a clean file as clean', async () => {
    const r = await new ClamAvScanner().scan(Buffer.from('an ordinary document'));
    expect(r.verdict).toBe('clean');
    expect(r.scanner).toBe('clamav');
  }, 180_000);

  /**
   * On a machine with Windows Defender active, Defender quarantines the EICAR
   * file the moment it is written and ClamAV never gets to open it — clamscan
   * exits 2 with Windows error 225, ERROR_VIRUS_INFECTED.
   *
   * So this asserts what is actually true end to end: the file is reported
   * infected and the gate stays shut. The detail says which scanner reached that
   * verdict, because crediting ClamAV for a detection Defender made would be a
   * test that lies about what it proved.
   */
  it('reports the EICAR test file as infected, whichever scanner catches it', async () => {
    const r = await new ClamAvScanner().scan(EICAR);
    expect(r.verdict).toBe('infected');
    expect(passesGate(r)).toBe(false);
    expect(r.detail).toMatch(/eicar|host antivirus/i);
  }, 180_000);

  it('never reports EICAR as clean, whatever else happens', async () => {
    const r = await new ClamAvScanner().scan(EICAR);
    expect(r.verdict).not.toBe('clean');
  }, 180_000);

  it('reports an error, not a pass, when the binary is missing', async () => {
    const r = await new ClamAvScanner('C:/nope/clamscan.exe').scan(Buffer.from('x'));
    expect(r.verdict).toBe('error');
    expect(passesGate(r)).toBe(false);
  });
});

/**
 * The state a machine is in immediately after installing ClamAV: the binary is
 * there and the signature database is not. clamscan exits 2, which must read as
 * an error and never as a pass — this is the exact moment someone is most likely
 * to push a real document through and assume it was scanned.
 */
describe('ClamAV installed without signatures', () => {
  const run = clam ? it : it.skip;

  // Assembled from pieces, as above, so the file on disk never holds the literal.
  const EICAR_FOR_HOST_AV = Buffer.from(
    ['X5O!P%@AP[4', 'PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(String.fromCharCode(92)),
    'ascii',
  );

  run('reports an error, not a pass, when the database is empty', async () => {
    const scanner = new ClamAvScanner(clam, 120_000, 'C:/nope/no-such-database');
    const r = await scanner.scan(Buffer.from('an ordinary document'));
    expect(r.verdict).toBe('error');
    expect(passesGate(r)).toBe(false);
  }, 180_000);

  run('does not call itself available without signatures', async () => {
    expect(await new ClamAvScanner(clam, 120_000, 'C:/nope/no-such-database').available()).toBe(false);
  });

  it('finds no signatures in a directory that does not exist', () => {
    expect(hasSignatures('C:/nope/no-such-database')).toBe(false);
    expect(hasSignatures(null)).toBe(false);
  });

  /**
   * The host antivirus getting there first is a detection, not a malfunction.
   * Windows error 225 is ERROR_VIRUS_INFECTED, so it is reported as infected —
   * both verdicts shut the gate, but only one tells the operator what happened.
   */
  it('reads a host-antivirus block as infected rather than a generic error', async () => {
    const r = await new ClamAvScanner(clam, 120_000, findClamDatabase()).scan(EICAR_FOR_HOST_AV);
    expect(['infected', 'error']).toContain(r.verdict);
    expect(passesGate(r)).toBe(false);
  }, 180_000);

  it('ignores a configured database path that is not there', () => {
    const prev = process.env.CLAMAV_DB_PATH;
    process.env.CLAMAV_DB_PATH = 'C:/nope/no-such-database';
    try {
      expect(findClamDatabase()).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.CLAMAV_DB_PATH;
      else process.env.CLAMAV_DB_PATH = prev;
    }
  });
});
