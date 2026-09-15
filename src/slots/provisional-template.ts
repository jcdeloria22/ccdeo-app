/**
 * A PROVISIONAL slot template, so DC-05 has something to exercise.
 *
 * ⚠ This list is NOT sourced. me-spec-sources puts required-document sets at
 * tier 3 — the DPWH materials QC/QA manual and standard forms — and is explicit
 * that a list must not be invented or carried forward without provenance:
 *
 *   > Where a source gives no answer and the correct value is genuinely
 *   > ambiguous, say so — do not invent a plausible number, and do not carry
 *   > forward a value whose provenance you cannot name.
 *
 * So every template created from this is flagged `provisional: true` with a
 * sourceNote saying exactly that, and the application must never present it as
 * verified. Replacing it is a new template VERSION, which is precisely what DC-05
 * is built to make cheap — projects already created keep the version they were
 * created under.
 *
 * The document names below come from the vocabulary used in me-spec-sources
 * (QCP, MMR, CQCA, MIR/EC and test reports). Their membership in a set, their
 * ordering and whether each is mandatory are ASSUMPTIONS.
 */
export const PROVISIONAL_TEMPLATE_CODE = 'materials-qa';

export const PROVISIONAL_SOURCE_NOTE =
  'PROVISIONAL — not sourced. Document names taken from me-spec-sources vocabulary; ' +
  'membership, order and mandatory flags are assumptions. Verify against the DPWH ' +
  'materials QC/QA manual and standard forms (tier 3) and publish a new version.';

export const PROVISIONAL_ITEMS = [
  { slotCode: 'qcp',        name: 'Quality Control Program (QCP)',                 required: true },
  { slotCode: 'mmr',        name: 'Monthly Materials Report (MMR)',                required: true },
  { slotCode: 'mir-ec',     name: 'Material Inspection Report / Evaluation Cert.', required: true },
  { slotCode: 'test-report', name: 'Materials test reports',                       required: true },
  { slotCode: 'cqca',       name: 'Certificate of Quality Control Assurance',      required: true },
  { slotCode: 'trial-mix',  name: 'Trial mix / design mix',                        required: false },
] as const;
