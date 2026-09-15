/**
 * DC-06 — the scan gate.
 *
 * The gate's only real requirement is that it fails closed. An upload is
 * `Quarantined` until a scanner says otherwise, and anything that is not an
 * explicit `clean` verdict — infected, an error, no scanner installed, a timeout
 * — leaves it quarantined. A quarantined upload cannot fill a slot.
 *
 * Defaulting to "probably fine" when the scanner is missing is the failure mode
 * worth designing against: that is exactly the state a machine is in after a
 * fresh checkout, and it is when someone is most likely to push a real document
 * through.
 */
export type ScanVerdict = 'clean' | 'infected' | 'error';

export interface ScanResult {
  readonly verdict: ScanVerdict;
  /** Signature name when infected; the reason when error. */
  readonly detail: string | null;
  /** Which scanner produced this, recorded on the upload. */
  readonly scanner: string;
  readonly scannedAt: Date;
}

export interface Scanner {
  readonly name: string;
  /** Whether this scanner can actually run right now. */
  available(): Promise<boolean>;
  scan(bytes: Buffer): Promise<ScanResult>;
}

/** True only for an explicit clean verdict. Everything else keeps it quarantined. */
export function passesGate(result: ScanResult | null | undefined): boolean {
  return result?.verdict === 'clean';
}

/**
 * A scanner that refuses everything, used when none is configured.
 *
 * It exists so that "no scanner" is a loud, explicit state rather than an absent
 * check. Wiring this in keeps every upload quarantined, which is correct.
 */
export class NoScanner implements Scanner {
  readonly name = 'none';
  async available(): Promise<boolean> {
    return true;
  }
  async scan(): Promise<ScanResult> {
    return {
      verdict: 'error',
      detail: 'no scanner configured — uploads stay quarantined until one is',
      scanner: this.name,
      scannedAt: new Date(),
    };
  }
}
