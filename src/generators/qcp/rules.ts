/**
 * QCP testing rules — the minimum testing requirements the generator may use.
 *
 * EVERY ROW HERE IS TRANSCRIBED, NOT DERIVED. The source is the owner's own
 * verification record, `05 - Knowledge/References/DPWH-Spec-Value-Conflicts.md`,
 * which checked these against the Minimum Testing Requirements (MTR) Vol II keyed
 * to the 2012 edition and dated December 2016 — tier 2 under me-spec-sources,
 * which is the correct tier for testing frequencies.
 *
 * Nothing in this file was inferred, rounded, interpolated, or remembered. A row
 * the record does not state is not here, and a row the record marks unresolved is
 * here as `unverified` so the generator refuses it out loud rather than omitting
 * it silently.
 *
 * ACCEPTANCE LIMITS come from a different document and carry their own provenance:
 * the DPWH Standard Specifications Volume II, **2013 edition**, tier 1, read
 * directly from the copy in the vault. That is the edition DO 197 s.2016 refers
 * to, and it supersedes the 2004 copy the verification record was based on.
 *
 * Three things the owner should know about this set:
 *
 *  1. These are CONTRACTOR quality-control frequencies. The record notes DPWH
 *     quality assurance is half as often; those rows are not transcribed here
 *     because the record does not enumerate them.
 *  2. Item 200 minimum soaked CBR is **30%**, settled. The verification record
 *     left it open (25% in the 2004 edition against 30% in later material, with
 *     no current Volume II on hand). §200.2 of the 2013 edition reads: "The
 *     material shall have a soaked CBR value of not less than 30% as determined
 *     by AASHTO T 193." The later edition did raise it, exactly as suspected.
 *  3. Items 310 and 311 carry frequencies but no acceptance limits, because those
 *     sections have not been read from the source yet. An absent limit is an
 *     absent limit; nothing is guessed to fill the column.
 */
import type { Provenance } from '../provenance';

/** Where a frequency is measured. `lot` means the rule is not a simple rate. */
export type BasisUnit = 'm3' | 'm2' | 'kg' | 'bag' | 'tonne' | 'drum' | 'lot';

/**
 * What the material must meet, as opposed to how often it is tested.
 *
 * These are a different question from a different document — acceptance limits
 * are tier 1 (the Standard Specifications), frequencies are tier 2 (the MTR) —
 * so they carry their own provenance rather than borrowing the rule's.
 */
export interface Acceptance {
  /** Condensed from the cited section. Every number and qualifier is the source's. */
  readonly requirement: string;
  readonly provenance: Provenance;
}

export interface TestingRule {
  readonly id: string;
  /** DPWH pay item the rule attaches to. */
  readonly item: string;
  readonly test: string;
  /** Exactly as the source states it. Printed verbatim; never paraphrased. */
  readonly frequency: string;
  /** One sample per this many `basisUnit`. Null when the rule is not a simple rate. */
  readonly perQuantity: number | null;
  readonly basisUnit: BasisUnit;
  readonly provenance: Provenance;
  /** Absent where no acceptance limit has been read from a source. Never guessed. */
  readonly acceptance?: Acceptance;
}

const MTR: Omit<Provenance, 'sourceSection'> = {
  sourceDocument: "DPWH Minimum Testing Requirements (MTR) Vol II",
  sourceYear: 2016,
  tier: 2,
  verifiedBy: 'Jayz',
  verifiedOn: '2026-08-25',
  caveat: 'keyed to the 2012 edition of the Standard Specifications; re-check against a current Volume II',
};

const mtr = (section: string): Provenance => ({ ...MTR, sourceSection: section });

/**
 * The 2013 Standard Specifications — tier 1, and the edition DO 197 s.2016 refers
 * to. Read directly from the copy held in the vault (`BONUS-DPWH Blue Book/
 * 2. DPWH BLUE BOOK V2 2013 (Chua).pdf`), not from memory and not from a reviewer
 * sheet.
 *
 * `verifiedBy` says HOW the row was checked rather than naming a person, because
 * an extraction is not a countersignature. me-spec-sources is explicit that an
 * assistant is not authority — so the owner's sign-off is recorded separately, in
 * `countersignedBy`, and the two facts are kept apart on purpose.
 *
 * Countersigned by the owner on 15 September 2026. These limits may now be cited
 * on an issued document. Changing a value here means doing that again.
 */
const bluebook2013 = (section: string): Provenance => ({
  sourceDocument: 'DPWH Standard Specifications for Highways, Bridges and Airports, Volume II',
  sourceSection: section,
  sourceYear: 2013,
  tier: 1,
  verifiedBy: 'extracted-from-source-pdf',
  verifiedOn: '2026-09-15',
  /*
   * Countersigned 15 September 2026. `verifiedBy` still records HOW each row was
   * checked — that fact did not change — and the countersignature records who
   * took responsibility for it. The caveat is gone because the thing it was
   * waiting for has happened.
   */
  countersignedBy: 'Jayz',
  countersignedOn: '2026-09-15',
  caveat: 'read from the 2013 edition held in the vault',
});

const acc = (requirement: string, section: string): Acceptance => ({
  requirement,
  provenance: bluebook2013(section),
});

/**
 * The rule set is versioned, and the version names the source rather than a
 * release number: a QCP generated last year has to be explainable by pointing at
 * the document it was generated from.
 */
export const QCP_RULES_VERSION = 'mtr-vol-ii-2012ed-2016-12';

export const QCP_TESTING_RULES: readonly TestingRule[] = [
  {
    id: 'qc.200.grading-plasticity',
    item: '200',
    test: 'Grading and plasticity',
    frequency: '1 per 300 m³ per source',
    perQuantity: 300,
    basisUnit: 'm3',
    provenance: mtr('Item 200 — aggregate subbase course'),
    acceptance: acc(
      'Grading per Table 200.1 (50 mm = 100; 25 mm = 55–85; 9.5 mm = 40–75; 0.075 mm = 0–12). Fraction passing 0.075 mm not greater than 0.66 of the fraction passing 0.425 mm. Fraction passing 0.425 mm: liquid limit not greater than 35, plasticity index not greater than 12 (AASHTO T 89 / T 90).',
      '§200.2, Table 200.1',
    ),
  },
  {
    id: 'qc.200.cbr-abrasion',
    item: '200',
    test: 'CBR and abrasion',
    frequency: '1 per 3,000 m³',
    perQuantity: 3000,
    basisUnit: 'm3',
    provenance: mtr('Item 200 — aggregate subbase course'),
    acceptance: acc(
      'Soaked CBR not less than 30% (AASHTO T 193), obtained at the maximum dry density determined by AASHTO T 180 Method D. Coarse portion retained on 2.00 mm: mass percent of wear not exceeding 50 (AASHTO T 96).',
      '§200.2',
    ),
  },
  {
    id: 'qc.200.compaction',
    item: '200',
    test: 'Field density (compaction)',
    frequency: '1 per 1,500 m³',
    perQuantity: 1500,
    basisUnit: 'm3',
    provenance: mtr('Item 200 — aggregate subbase course'),
    acceptance: acc(
      'Field density at least 100% of the maximum dry density determined by AASHTO T 180 Method D; in-place density determined by AASHTO T 191. Layers of more than 150 mm required thickness compacted in two or more layers, no compacted layer exceeding 150 mm.',
      '§200.3.3',
    ),
  },
  {
    id: 'qc.201.grading-plasticity',
    item: '201',
    test: 'Grading and plasticity',
    frequency: '1 per 300 m³ per source',
    perQuantity: 300,
    basisUnit: 'm3',
    provenance: mtr('Item 201 — aggregate base course'),
    acceptance: acc(
      'Grading per Table 201.1 (Grading A or B, whichever the Bill of Quantities calls for). Fraction passing 0.075 mm not greater than 0.66 of the fraction passing 0.425 mm. Fraction passing 0.425 mm: liquid limit not greater than 25, plasticity index not greater than 6 (AASHTO T 89 / T 90).',
      '§201.2, Table 201.1',
    ),
  },
  {
    id: 'qc.201.cbr-abrasion',
    item: '201',
    test: 'CBR and abrasion',
    frequency: '1 per 3,000 m³',
    perQuantity: 3000,
    basisUnit: 'm3',
    provenance: mtr('Item 201 — aggregate base course'),
    acceptance: acc(
      'Material passing the 19 mm sieve: soaked CBR not less than 80% (AASHTO T 193), at maximum dry density by AASHTO T 180 Method D. Coarse portion retained on 2.00 mm: mass percent of wear not exceeding 50 (AASHTO T 96).',
      '§201.2',
    ),
  },
  {
    id: 'qc.201.compaction',
    item: '201',
    test: 'Field density (compaction)',
    frequency: '1 per 1,500 m³',
    perQuantity: 1500,
    basisUnit: 'm3',
    provenance: mtr('Item 201 — aggregate base course'),
    acceptance: acc(
      'Field density at least 100% of the maximum dry density determined by AASHTO T 180 Method D (Item 201 construction requirements follow Subsection 200.3.3).',
      '§201.3.3 via §200.3.3',
    ),
  },
  {
    // The record flags this one specifically: 202 is NOT lumped in with 200/201.
    id: 'qc.202.cbr-abrasion-fractured-face',
    item: '202',
    test: 'CBR, abrasion, and fractured face',
    frequency: '1 per 1,500 m³',
    perQuantity: 1500,
    basisUnit: 'm3',
    provenance: mtr('Item 202 — crushed aggregate base course'),
    acceptance: acc(
      'Material passing 0.425 mm: liquid limit not more than 25, plasticity index not more than 6 (AASHTO T 89 / T 90). Coarse aggregate retained on 2.00 mm: mass percent of wear not exceeding 45 (AASHTO T 96), and not less than 50 mass percent having at least one fractured face. Material passing 19 mm: minimum soaked CBR 80% (AASHTO T 193) at maximum dry density by AASHTO T 180 Method D.',
      '§202.2',
    ),
  },
  {
    id: 'qc.310.binder',
    item: '310',
    test: 'Bituminous material (binder)',
    frequency: '1 per 40 metric tons or 200 drums',
    perQuantity: 40,
    basisUnit: 'tonne',
    provenance: mtr('Item 310 — bituminous concrete surface course'),
  },
  {
    id: 'qc.310.mix-grading',
    item: '310',
    test: 'Bituminous mix grading',
    frequency: '1 per 130 metric tons',
    perQuantity: 130,
    basisUnit: 'tonne',
    provenance: mtr('Item 310 — bituminous concrete surface course'),
  },
  {
    id: 'qc.311.cement',
    item: '311',
    test: 'Cement',
    frequency: '1 per 2,000 bags per shipment',
    perQuantity: 2000,
    basisUnit: 'bag',
    provenance: mtr('Item 311 — Portland cement concrete pavement'),
  },
  {
    id: 'qc.311.fine-aggregate-water',
    item: '311',
    test: 'Fine aggregate and water',
    frequency: '1 per 75 m³',
    perQuantity: 75,
    basisUnit: 'm3',
    provenance: mtr('Item 311 — Portland cement concrete pavement'),
  },
  {
    // Deliberately NOT reduced to a single rate: the source states two area bases
    // and a volume cap, and collapsing that into one number would be inventing a
    // rule. The generator prints it verbatim and computes nothing.
    id: 'qc.311.beam-samples',
    item: '311',
    test: 'Flexural beam samples',
    frequency:
      '1 set (3 beams) per 270 m² at 280 mm depth, or per 250 m² at 300 mm depth; maximum 75 m³ per set',
    perQuantity: null,
    basisUnit: 'lot',
    provenance: mtr('Item 311 — Portland cement concrete pavement'),
  },
  {
    id: 'qc.311.reinforcing-steel',
    item: '311',
    test: 'Reinforcing steel',
    frequency: '1 per 10,000 kg of each size from each source',
    perQuantity: 10000,
    basisUnit: 'kg',
    provenance: mtr('Item 311 — Portland cement concrete pavement'),
  },
];

export function rulesForItem(item: string, rules: readonly TestingRule[] = QCP_TESTING_RULES): TestingRule[] {
  return rules.filter((r) => r.item === item);
}

/** Every pay item the rule set covers at all. */
export function coveredItems(rules: readonly TestingRule[] = QCP_TESTING_RULES): string[] {
  return [...new Set(rules.map((r) => r.item))].sort();
}
