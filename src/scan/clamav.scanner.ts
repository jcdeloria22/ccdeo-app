/**
 * ClamAV, driven through `clamscan`.
 *
 * `clamscan` loads the signature database on every invocation, which costs a few
 * seconds per file. That is fine for uploads — they are not hot-path — and it
 * avoids running and supervising the `clamd` daemon. If throughput ever matters,
 * swapping to clamd is a change to this file alone.
 *
 * Exit codes: 0 clean, 1 infected, anything else an error. An error is NOT a
 * pass — `passesGate` only accepts an explicit clean verdict.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Scanner, ScanResult } from './scanner';

const CANDIDATES = [
  'C:/Program Files/ClamAV/clamscan.exe',
  'C:/Program Files (x86)/ClamAV/clamscan.exe',
  '/usr/bin/clamscan',
  '/usr/local/bin/clamscan',
];

export function findClamscan(): string | null {
  if (process.env.CLAMSCAN_PATH && existsSync(process.env.CLAMSCAN_PATH)) return process.env.CLAMSCAN_PATH;
  return CANDIDATES.find((p) => existsSync(p)) ?? null;
}

/**
 * Where the signature database lives.
 *
 * A fresh ClamAV install has the binary and no signatures, and its default
 * database directory sits under Program Files, which needs administrator rights
 * to populate. So the path is configurable and `freshclam` can write somewhere
 * the user actually owns. A container image will need this for the same reason.
 *
 * Null means "let clamscan use its compiled-in default".
 */
export function findClamDatabase(): string | null {
  const configured = process.env.CLAMAV_DB_PATH;
  return configured && existsSync(configured) ? configured : null;
}

/**
 * Does the database directory hold any signatures?
 *
 * An installed scanner with an empty database reports an error on every file,
 * which the gate correctly refuses to treat as a pass — but the reason is worth
 * naming, because "no signatures yet" and "the scanner is broken" need different
 * responses from whoever is looking at it.
 */
export function hasSignatures(dir: string | null = findClamDatabase()): boolean {
  if (!dir || !existsSync(dir)) return false;
  return readdirSync(dir).some((f) => /\.(cvd|cld|cud)$/i.test(f));
}

/**
 * Windows error 225 is ERROR_VIRUS_INFECTED: the operating system's own
 * antivirus has already decided the file is malware and will not let anything
 * open it — ClamAV included.
 *
 * Reporting that as a generic error would be fail-closed but wasteful, because
 * it throws away a verdict the machine has already reached. An operator reading
 * the register needs to know a file was refused as infected, not that some
 * unspecified thing went wrong. Both outcomes block the gate; only one of them
 * says what happened.
 *
 * Matched on the specific message rather than the bare number, so an unrelated
 * "225" in a filename or a signature name cannot trigger it.
 */
const HOST_AV_BLOCKED = /Can't open file .*: 225(\s|$)/;

export class ClamAvScanner implements Scanner {
  readonly name = 'clamav';

  constructor(
    private readonly binary: string | null = findClamscan(),
    private readonly timeoutMs = 120_000,
    private readonly databasePath: string | null = findClamDatabase(),
  ) {}

  /**
   * Available means it can actually deliver a verdict — a binary with no
   * signatures cannot. Reporting it available would make "no scanner configured"
   * and "scanner that says error on everything" look like different situations
   * when they are the same one.
   */
  async available(): Promise<boolean> {
    return this.binary !== null && hasSignatures(this.databasePath);
  }

  async scan(bytes: Buffer): Promise<ScanResult> {
    const scannedAt = new Date();
    if (!this.binary) {
      return { verdict: 'error', detail: 'clamscan not found on this machine', scanner: this.name, scannedAt };
    }

    const dir = await mkdtemp(path.join(os.tmpdir(), 'dpwh-scan-'));
    const file = path.join(dir, 'upload.bin');
    try {
      await writeFile(file, bytes);
      const { code, out } = await this.run(file);

      if (code === 0) return { verdict: 'clean', detail: null, scanner: this.name, scannedAt };
      if (code === 1) {
        const m = out.match(/:\s*(.+?)\s+FOUND/);
        return { verdict: 'infected', detail: m ? m[1] : 'signature match', scanner: this.name, scannedAt };
      }
      if (HOST_AV_BLOCKED.test(out)) {
        return {
          verdict: 'infected',
          detail:
            'blocked by the host antivirus before ClamAV could read it ' +
            '(Windows error 225, ERROR_VIRUS_INFECTED)',
          scanner: this.name,
          scannedAt,
        };
      }
      return {
        verdict: 'error',
        detail: `clamscan exited ${code}: ${out.trim().slice(0, 200) || 'no output'}`,
        scanner: this.name,
        scannedAt,
      };
    } catch (e) {
      return { verdict: 'error', detail: (e as Error).message.slice(0, 200), scanner: this.name, scannedAt };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private run(file: string): Promise<{ code: number; out: string }> {
    return new Promise((resolve) => {
      const args = ['--no-summary', '--stdout'];
      if (this.databasePath) args.push(`--database=${this.databasePath}`);
      args.push(file);

      const child = spawn(this.binary as string, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      const finish = (code: number) => { clearTimeout(timer); resolve({ code, out }); };
      const timer = setTimeout(() => { child.kill('SIGKILL'); finish(-1); }, this.timeoutMs);

      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { out += d; });
      child.on('error', (e) => { out += e.message; finish(-2); });
      child.on('close', (code) => finish(code ?? -3));
    });
  }
}
