/**
 * Provenance and verification for generator rules.
 *
 * me-spec-sources:
 *
 *   > Every rule row carries `source_document`, `source_section`, `source_year`,
 *   > plus `verified_by` and `verified_on`. Rows start as `unverified`.
 *   > **An unverified rule may not be used by a generator.** Enforce this in
 *   > code, not by convention.
 *
 * So verification is a property of the rule, checked here, rather than a habit of
 * whoever wrote the generator. A wrong spec value in an official-looking document
 * is a field-safety problem: the failure mode this file exists to prevent is a
 * plausible number appearing in a QCP with nothing behind it.
 */

/** 1 = Standard Specifications Vol II, 2 = Department Orders and issuances, 3 = QC/QA manual and forms. */
export type Tier = 1 | 2 | 3;

export interface Provenance {
  readonly sourceDocument: string;
  readonly sourceSection: string;
  /** Edition or issuance year of the source, not the year it was read. */
  readonly sourceYear: number;
  readonly tier: Tier;
  readonly verifiedBy: string | null;
  /** ISO date. Null until someone has actually checked it against the source. */
  readonly verifiedOn: string | null;
  /** Anything that qualifies the row — a superseded edition, an open conflict. */
  readonly caveat?: string;
  /**
   * Who signed the row off, where that is a different act from checking it.
   *
   * An extraction and a countersignature are not the same fact. `verifiedBy` says
   * HOW a row was checked — read from the source PDF, say — and that is true
   * whoever later accepts it. This says who took responsibility for it. Keeping
   * both means the chain still reads correctly afterwards: the row was extracted
   * this way, and then this person signed it.
   */
  readonly countersignedBy?: string;
  /** ISO date of the countersignature. */
  readonly countersignedOn?: string;
}

export type RuleStatus = 'verified' | 'unverified';

export function statusOf(p: Provenance): RuleStatus {
  return p.verifiedBy && p.verifiedOn ? 'verified' : 'unverified';
}

export function isVerified(p: Provenance): boolean {
  return statusOf(p) === 'verified';
}

/** One line naming where a value came from, for printing next to it. */
export function citation(p: Provenance): string {
  const base = `${p.sourceDocument} ${p.sourceSection} (${p.sourceYear}, tier ${p.tier})`;
  const notes = [
    p.countersignedBy ? `countersigned by ${p.countersignedBy} on ${p.countersignedOn}` : null,
    p.caveat ?? null,
  ].filter((n): n is string => n !== null);
  return notes.length ? `${base} — ${notes.join('; ')}` : base;
}

export function isCountersigned(p: Provenance): boolean {
  return Boolean(p.countersignedBy && p.countersignedOn);
}

export class UnverifiedRuleError extends Error {
  constructor(ruleId: string, p: Provenance) {
    super(
      `Rule "${ruleId}" is unverified and may not be used by a generator. ` +
        `Its source is ${citation(p)}. Verify it against tier 1 or tier 2 and record who checked it and when.`,
    );
    this.name = 'UnverifiedRuleError';
  }
}

/**
 * Use this wherever a rule's value is about to be read.
 *
 * It throws rather than returning a flag so that an unverified value cannot reach
 * an artifact by someone forgetting to check the flag.
 */
export function requireVerified<T extends { readonly id: string; readonly provenance: Provenance }>(rule: T): T {
  if (!isVerified(rule.provenance)) throw new UnverifiedRuleError(rule.id, rule.provenance);
  return rule;
}
