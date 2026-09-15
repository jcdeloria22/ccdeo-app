/**
 * The first generator.
 *
 * The tests that matter most here are not about output shape. They are:
 * an unverified rule can never reach an artifact, no value is ever invented for a
 * gap, the function is pure (same input, same output, no clock), and simulation
 * output is unmistakable. A golden file pins the rest.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { generateQcp, minimumSamples, normaliseUnit, type QcpInput } from '../src/generators/qcp/generate';
import {
  QCP_RULES_VERSION, QCP_TESTING_RULES, coveredItems, rulesForItem, type TestingRule,
} from '../src/generators/qcp/rules';
import { isVerified, requireVerified, statusOf, UnverifiedRuleError } from '../src/generators/provenance';

const GOLDEN = path.join(__dirname, 'golden', 'qcp-26hh0001.json');

/**
 * Synthetic rules for the enforcement tests.
 *
 * The shipped set is fully verified, which is as it should be — so proving the
 * gate works needs a rule built to fail it. Tier 1 and a named section are
 * deliberately present: they are not what makes a row usable.
 */
const UNVERIFIED_RULE: TestingRule = {
  id: 'test.unverified',
  item: '200',
  test: 'Something nobody has checked',
  frequency: 'one per unchecked lot',
  perQuantity: 500,
  basisUnit: 'm3',
  provenance: {
    sourceDocument: 'DPWH Standard Specifications Vol II',
    sourceSection: '§200.2',
    sourceYear: 2004,
    tier: 1,
    verifiedBy: null,
    verifiedOn: null,
  },
};

const UNVERIFIED_ACCEPTANCE: TestingRule = {
  ...QCP_TESTING_RULES.find((r) => r.id === 'qc.200.grading-plasticity')!,
  acceptance: {
    requirement: 'Some limit nobody has checked',
    provenance: {
      sourceDocument: 'DPWH Standard Specifications Vol II',
      sourceSection: '§200.2',
      sourceYear: 2004,
      tier: 1,
      verifiedBy: null,
      verifiedOn: null,
    },
  },
};

const input: QcpInput = {
  project: {
    contractId: '26HH0001',
    name: 'Rehabilitation of Barangay Road, Section 1',
    location: 'Cebu, Region VII',
    implementingOffice: 'DPWH Cebu 1st District Engineering Office',
  },
  items: [
    { itemNumber: '200', description: 'Aggregate subbase course', quantity: 1250, unit: 'cu.m' },
    { itemNumber: '201', description: 'Aggregate base course', quantity: 900, unit: 'm³' },
    { itemNumber: '311', description: 'PCCP, 200 mm thick', quantity: 3400, unit: 'sq.m' },
  ],
  preparedOn: '2026-09-15',
  preparedBy: 'Jayz, Materials Engineer I',
  mode: 'real',
};

describe('the rule set', () => {
  it('carries full provenance on every row', () => {
    for (const r of QCP_TESTING_RULES) {
      expect(r.provenance.sourceDocument.length).toBeGreaterThan(0);
      expect(r.provenance.sourceSection.length).toBeGreaterThan(0);
      expect(r.provenance.sourceYear).toBeGreaterThan(1900);
      expect([1, 2, 3]).toContain(r.provenance.tier);
    }
  });

  it('draws testing frequencies from tier 2 or better', () => {
    for (const r of QCP_TESTING_RULES.filter((x) => x.perQuantity !== null)) {
      expect(r.provenance.tier).toBeLessThanOrEqual(2);
    }
  });

  it('treats a row with no verifier as unverified, whatever else it carries', () => {
    // Tier 1 and a named section are not verification. Only a verifier and a date are.
    expect(statusOf(UNVERIFIED_RULE.provenance)).toBe('unverified');
    expect(isVerified(UNVERIFIED_RULE.provenance)).toBe(false);
    expect(() => requireVerified(UNVERIFIED_RULE)).toThrow(UnverifiedRuleError);
  });

  it('holds no unverified rule in the shipped set', () => {
    for (const r of QCP_TESTING_RULES) {
      expect(isVerified(r.provenance)).toBe(true);
      if (r.acceptance) expect(isVerified(r.acceptance.provenance)).toBe(true);
    }
  });

  /**
   * The rule the 2013 edition settled. The verification record left it open —
   * 25% in the 2004 edition against 30% in later material — and section 200.2 of
   * the 2013 edition, the one DO 197 s.2016 refers to, reads "not less than 30%".
   */
  it('carries the Item 200 soaked CBR at 30%, cited to the 2013 edition', () => {
    const cbr = QCP_TESTING_RULES.find((r) => r.id === 'qc.200.cbr-abrasion');
    expect(cbr?.acceptance?.requirement).toContain('not less than 30%');
    expect(cbr?.acceptance?.requirement).not.toContain('25%');
    expect(cbr?.acceptance?.provenance.sourceYear).toBe(2013);
    expect(cbr?.acceptance?.provenance.tier).toBe(1);
    expect(cbr?.acceptance?.provenance.sourceSection).toBe('§200.2');
  });

  it('keeps subbase and base apart — 30% against 80%, the recurring trap', () => {
    const subbase = QCP_TESTING_RULES.find((r) => r.id === 'qc.200.cbr-abrasion');
    const base = QCP_TESTING_RULES.find((r) => r.id === 'qc.201.cbr-abrasion');
    expect(subbase?.acceptance?.requirement).toContain('30%');
    expect(base?.acceptance?.requirement).toContain('80%');
    expect(subbase?.acceptance?.requirement).toContain('not exceeding 50');
  });

  it('takes acceptance limits from tier 1 and frequencies from tier 2', () => {
    for (const r of QCP_TESTING_RULES) {
      expect(r.provenance.tier).toBe(2);
      if (r.acceptance) expect(r.acceptance.provenance.tier).toBe(1);
    }
  });

  it('leaves the acceptance column empty where no source has been read', () => {
    for (const r of QCP_TESTING_RULES.filter((x) => x.item === '310' || x.item === '311')) {
      expect(r.acceptance).toBeUndefined();
    }
  });

  it('separates Item 202 from 200 and 201, as the verification record requires', () => {
    expect(rulesForItem('202').every((r) => r.perQuantity === 1500)).toBe(true);
    expect(rulesForItem('200').find((r) => r.test.includes('CBR and abrasion'))!.perQuantity).toBe(3000);
  });

  it('covers the items the record actually enumerates, and claims no others', () => {
    expect(coveredItems()).toEqual(['200', '201', '202', '310', '311']);
  });

  it('never reduces the beam-sample rule to a single rate', () => {
    const beams = QCP_TESTING_RULES.find((r) => r.id === 'qc.311.beam-samples')!;
    expect(beams.perQuantity).toBeNull();
    expect(beams.frequency).toContain('270 m²');
    expect(beams.frequency).toContain('250 m²');
    expect(beams.frequency).toContain('75 m³');
  });
});

describe('sample arithmetic', () => {
  it('rounds up, because rounding down under-tests real work', () => {
    expect(minimumSamples(310, 300)).toBe(2);
    expect(minimumSamples(600, 300)).toBe(2);
    expect(minimumSamples(601, 300)).toBe(3);
  });

  it('never returns zero for work that exists', () => {
    expect(minimumSamples(5, 300)).toBe(1);
    expect(minimumSamples(0.1, 3000)).toBe(1);
  });

  it('returns zero only for no work at all', () => {
    expect(minimumSamples(0, 300)).toBe(0);
    expect(minimumSamples(-5, 300)).toBe(0);
  });

  it('understands the unit spellings a bill of quantities actually uses', () => {
    for (const u of ['m3', 'm³', 'cu.m', 'CUM', 'cubic meter']) expect(normaliseUnit(u)).toBe('m3');
    for (const u of ['sq.m', 'm²', 'SQM']) expect(normaliseUnit(u)).toBe('m2');
    for (const u of ['MT', 'metric tons', 'tonne']) expect(normaliseUnit(u)).toBe('tonne');
    expect(normaliseUnit('furlong')).toBeNull();
  });
});

describe('the generator', () => {
  it('is pure: the same input gives the same output, twice', () => {
    expect(generateQcp(input)).toEqual(generateQcp(input));
  });

  it('reads no clock — the prepared date is whatever was passed in', () => {
    const out = generateQcp({ ...input, preparedOn: '1999-01-01' });
    expect(out.artifact.preparedOn).toBe('1999-01-01');
  });

  it('computes sample counts from verified rates', () => {
    const out = generateQcp(input);
    const subbase = out.artifact.sections.find((s) => s.itemNumber === '200')!;
    expect(subbase.tests.find((t) => t.test === 'Grading and plasticity')!.minimumSamples).toBe(5); // 1250 / 300
    expect(subbase.tests.find((t) => t.test.startsWith('CBR'))!.minimumSamples).toBe(1); // 1250 / 3000
    expect(subbase.tests.find((t) => t.test.startsWith('Field density'))!.minimumSamples).toBe(1);
  });

  /** The central rule of me-spec-sources, and the reason this file exists. */
  it('never prints a value for an unverified rule, and says so', () => {
    const out = generateQcp(input, QCP_RULES_VERSION, [UNVERIFIED_RULE]);
    const row = out.artifact.sections.find((s) => s.itemNumber === '200')!.tests[0];

    expect(row.withheld).not.toBeNull();
    expect(row.minimumSamples).toBeNull();
    expect(row.frequency).toBe('WITHHELD — pending verification');
    expect(row.frequency).not.toMatch(/[0-9]/);
    expect(out.warnings.some((w) => w.includes(UNVERIFIED_RULE.id))).toBe(true);
  });

  it('keeps the withheld rule visible rather than dropping it', () => {
    const out = generateQcp(input, QCP_RULES_VERSION, [UNVERIFIED_RULE]);
    const tests = out.artifact.sections.find((s) => s.itemNumber === '200')!.tests;
    expect(tests).toHaveLength(1);
    expect(tests[0].test).toBe(UNVERIFIED_RULE.test);
  });

  it('withholds an unverified acceptance limit while keeping a verified frequency', () => {
    const out = generateQcp(input, QCP_RULES_VERSION, [UNVERIFIED_ACCEPTANCE]);
    const row = out.artifact.sections.find((s) => s.itemNumber === '200')!.tests[0];
    expect(row.frequency).toBe('1 per 300 m³ per source');
    expect(row.minimumSamples).toBe(5);
    expect(row.acceptance).toBe('WITHHELD — pending verification');
    expect(row.acceptanceCitation).toBeNull();
    expect(out.warnings.some((w) => w.includes('Acceptance limit'))).toBe(true);
  });

  it('prints the acceptance limit and its own citation alongside the frequency', () => {
    const out = generateQcp(input);
    const row = out.artifact.sections
      .find((s) => s.itemNumber === '200')!
      .tests.find((t) => t.test === 'CBR and abrasion')!;
    expect(row.acceptance).toContain('not less than 30%');
    expect(row.acceptanceCitation).toContain('2013');
    expect(row.citation).toContain('Minimum Testing Requirements');
  });

  it('cites no unverified source in the provenance list', () => {
    const out = generateQcp(input);
    expect(out.provenance.every((p) => isVerified(p))).toBe(true);
  });

  it('warns and computes nothing when the units do not match the rule', () => {
    const out = generateQcp(input);
    const pccp = out.artifact.sections.find((s) => s.itemNumber === '311')!;
    const cement = pccp.tests.find((t) => t.test === 'Cement')!;
    expect(cement.minimumSamples).toBeNull(); // bags against square metres
    expect(out.warnings.some((w) => w.includes('Cement'))).toBe(true);
  });

  it('lists an item it has no rules for, instead of quietly dropping it', () => {
    const out = generateQcp({
      ...input,
      items: [{ itemNumber: '999', description: 'Something unheard of', quantity: 10, unit: 'm3' }],
    });
    expect(out.artifact.sections).toHaveLength(1);
    expect(out.artifact.sections[0].tests).toEqual([]);
    expect(out.warnings.some((w) => w.includes('Item 999'))).toBe(true);
  });

  it('says plainly when it was given nothing', () => {
    const out = generateQcp({ ...input, items: [] });
    expect(out.artifact.sections).toEqual([]);
    expect(out.warnings.some((w) => w.includes('covers nothing'))).toBe(true);
  });

  it('warns rather than inventing counts for a zero quantity', () => {
    const out = generateQcp({
      ...input,
      items: [{ itemNumber: '201', description: 'Aggregate base course', quantity: 0, unit: 'm3' }],
    });
    expect(out.warnings.some((w) => w.includes('quantity of 0'))).toBe(true);
    for (const t of out.artifact.sections[0].tests) {
      if (t.minimumSamples !== null) expect(t.minimumSamples).toBe(0);
    }
  });

  it('refuses a rules version it does not carry', () => {
    expect(() => generateQcp(input, 'mtr-vol-ii-2099')).toThrow(/Unknown rules version/);
    expect(() => generateQcp(input, QCP_RULES_VERSION)).not.toThrow();
  });

  it('records which rules version produced the document', () => {
    expect(generateQcp(input).artifact.rulesVersion).toBe(QCP_RULES_VERSION);
  });

  it('carries the caveat forward when a source is keyed to a superseded edition', () => {
    const out = generateQcp(input);
    expect(out.artifact.notices.some((n) => n.includes('current Volume II'))).toBe(true);
  });

  /**
   * "No database, no filesystem, no clock" is a property of what the module may
   * import, so that is what is checked — the import specifiers, not the file's
   * text. Scanning the text matches prose in the comments and proves nothing.
   */
  it('imports nothing outside its own rules and provenance helpers', () => {
    const source = readFileSync(path.join(__dirname, '..', 'src', 'generators', 'qcp', 'generate.ts'), 'utf8');
    const specifiers = [...source.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const s of specifiers) expect(s.startsWith('.')).toBe(true);
    expect(specifiers.some((s) => /(^pg$|node:|fs|http|child_process)/.test(s))).toBe(false);
  });

  it('calls no clock', () => {
    const code = readFileSync(path.join(__dirname, '..', 'src', 'generators', 'qcp', 'generate.ts'), 'utf8')
      // strip block and line comments so prose about the clock is not mistaken for a call
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(code).not.toMatch(/Date\.now\(|new Date\(/);
  });
});

describe('simulation output', () => {
  const sim = generateQcp({ ...input, mode: 'simulation' });

  it('is unmistakable — watermark, header, footer, and filename prefix', () => {
    const banner = 'EDUCATIONAL SIMULATION — NOT FOR CONSTRUCTION, ACCEPTANCE, OR PAYMENT';
    expect(sim.artifact.simulation).toEqual({
      watermark: banner,
      header: banner,
      footer: banner,
      filenamePrefix: 'SIM_',
    });
    expect(sim.artifact.title.startsWith('SIM_')).toBe(true);
    expect(sim.artifact.notices[0]).toBe(banner);
  });

  it('marks nothing when the document is real', () => {
    const real = generateQcp(input);
    expect(real.artifact.simulation).toBeNull();
    expect(real.artifact.title.startsWith('SIM_')).toBe(false);
    expect(real.artifact.notices.join(' ')).not.toContain('SIMULATION');
  });

  it('applies the same rules either way — simulation changes the marking, not the values', () => {
    const real = generateQcp(input);
    expect(sim.artifact.sections).toEqual(real.artifact.sections);
  });
});

/**
 * The golden file. Run with UPDATE_GOLDEN=1 to rewrite it deliberately; a diff
 * that appears without that is a change in generated output, which is exactly the
 * thing that should never happen by accident.
 */
describe('golden file', () => {
  it('matches the recorded output for a known project', () => {
    const actual = JSON.stringify(generateQcp(input), null, 2) + '\n';

    if (process.env.UPDATE_GOLDEN === '1' || !existsSync(GOLDEN)) {
      writeFileSync(GOLDEN, actual, 'utf8');
    }

    expect(actual).toBe(readFileSync(GOLDEN, 'utf8'));
  });
});
