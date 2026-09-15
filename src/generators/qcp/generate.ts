/**
 * The first generator: a Quality Control Program.
 *
 *   > Generators are pure functions: `(structuredInput, rulesVersion) →
 *   > { artifact, warnings, provenance }`. No database, no filesystem, no clock.
 *   > Golden-file test per template. A generator may not use an unverified rule.
 *
 * All four hold here. There is no `Date.now()` — the preparation date is an input,
 * because a pure function that reads the clock is not one and its golden file
 * would change every day for no reason.
 *
 * What this does NOT do is decide anything. It selects rules that cover the pay
 * items it was given, does arithmetic on frequencies that are simple rates, and
 * says plainly what it could not cover. Where the rule set is silent or unsettled
 * it produces a warning and a visible gap, never a plausible number.
 */
import { citation, isVerified, type Provenance } from '../provenance';
import { QCP_RULES_VERSION, QCP_TESTING_RULES, rulesForItem, type BasisUnit, type TestingRule } from './rules';

export type Mode = 'real' | 'simulation';

export interface QcpItemInput {
  /** DPWH pay item number, e.g. "201". */
  readonly itemNumber: string;
  readonly description: string;
  readonly quantity: number;
  readonly unit: string;
}

export interface QcpInput {
  readonly project: {
    readonly contractId: string;
    readonly name: string;
    readonly location: string;
    readonly implementingOffice: string;
  };
  readonly items: readonly QcpItemInput[];
  /** ISO date. An input, not a clock read — see the file comment. */
  readonly preparedOn: string;
  readonly preparedBy: string;
  readonly mode: Mode;
}

export interface QcpTestRow {
  readonly test: string;
  /** Verbatim from the source. */
  readonly frequency: string;
  /** Null when the rule is not a simple rate, or the units do not match. */
  readonly minimumSamples: number | null;
  readonly basis: string;
  readonly citation: string;
  /** What the material must meet. Null where no limit has been read from a source. */
  readonly acceptance: string | null;
  readonly acceptanceCitation: string | null;
  /** Set only when nothing may be printed; the row stays visible as a gap. */
  readonly withheld: string | null;
}

export interface QcpSection {
  readonly itemNumber: string;
  readonly description: string;
  readonly quantity: number;
  readonly unit: string;
  readonly tests: readonly QcpTestRow[];
}

export interface QcpArtifact {
  readonly title: string;
  readonly project: QcpInput['project'];
  readonly preparedOn: string;
  readonly preparedBy: string;
  readonly rulesVersion: string;
  readonly mode: Mode;
  /** Present only in simulation mode, and unmissable when it is. */
  readonly simulation: SimulationMarking | null;
  readonly sections: readonly QcpSection[];
  readonly notices: readonly string[];
}

export interface SimulationMarking {
  readonly watermark: string;
  readonly header: string;
  readonly footer: string;
  readonly filenamePrefix: string;
}

const SIMULATION_BANNER = 'EDUCATIONAL SIMULATION — NOT FOR CONSTRUCTION, ACCEPTANCE, OR PAYMENT';

const SIMULATION_MARKING: SimulationMarking = {
  watermark: SIMULATION_BANNER,
  header: SIMULATION_BANNER,
  footer: SIMULATION_BANNER,
  filenamePrefix: 'SIM_',
};

export interface GeneratorOutput {
  readonly artifact: QcpArtifact;
  readonly warnings: readonly string[];
  readonly provenance: readonly Provenance[];
}

/** Units the rules are expressed in, and the spellings a bill of quantities uses for them. */
const UNIT_ALIASES: Record<string, BasisUnit> = {
  'm3': 'm3', 'm³': 'm3', 'cu.m': 'm3', 'cu. m': 'm3', 'cum': 'm3', 'cubic meter': 'm3', 'cubic metre': 'm3',
  'm2': 'm2', 'm²': 'm2', 'sq.m': 'm2', 'sq. m': 'm2', 'sqm': 'm2', 'square meter': 'm2', 'square metre': 'm2',
  'kg': 'kg', 'kilogram': 'kg', 'kgs': 'kg',
  'bag': 'bag', 'bags': 'bag',
  't': 'tonne', 'mt': 'tonne', 'tonne': 'tonne', 'tonnes': 'tonne', 'metric ton': 'tonne', 'metric tons': 'tonne',
  'drum': 'drum', 'drums': 'drum',
};

export function normaliseUnit(unit: string): BasisUnit | null {
  return UNIT_ALIASES[unit.trim().toLowerCase()] ?? null;
}

/**
 * Samples needed to satisfy a rate.
 *
 * Always rounds up and never returns zero for a non-zero quantity: "1 per 300 m³"
 * against 310 m³ is two samples, and against 5 m³ it is still one. Rounding down
 * anywhere here would under-test real work.
 */
export function minimumSamples(quantity: number, perQuantity: number): number {
  if (!(quantity > 0)) return 0;
  return Math.max(1, Math.ceil(quantity / perQuantity));
}

/**
 * Acceptance limits go through the same gate as everything else: an unverified
 * limit is withheld with a warning, and a limit that was never read from a source
 * is simply absent. A blank column is honest; a plausible number is not.
 */
function acceptanceOf(rule: TestingRule, warnings: string[]): Pick<QcpTestRow, 'acceptance' | 'acceptanceCitation'> {
  if (!rule.acceptance) return { acceptance: null, acceptanceCitation: null };

  if (!isVerified(rule.acceptance.provenance)) {
    warnings.push(
      `Acceptance limit for "${rule.test}" (rule ${rule.id}) is unverified ` +
        `(${citation(rule.acceptance.provenance)}). No limit has been printed for it.`,
    );
    return { acceptance: 'WITHHELD — pending verification', acceptanceCitation: null };
  }

  return {
    acceptance: rule.acceptance.requirement,
    acceptanceCitation: citation(rule.acceptance.provenance),
  };
}

function rowFor(rule: TestingRule, item: QcpItemInput, warnings: string[]): QcpTestRow {
  const base = {
    test: rule.test,
    frequency: rule.frequency,
    citation: citation(rule.provenance),
    ...acceptanceOf(rule, warnings),
  };

  // The enforcement point. An unverified rule never contributes a value.
  if (!isVerified(rule.provenance)) {
    const why =
      `Rule "${rule.id}" is unverified (${citation(rule.provenance)}). ` +
      'No value has been printed for it; verify against tier 1 or tier 2 before this QCP is used.';
    warnings.push(why);
    return {
      ...base,
      frequency: 'WITHHELD — pending verification',
      minimumSamples: null,
      basis: '—',
      withheld: why,
    };
  }

  if (rule.perQuantity === null) {
    return { ...base, minimumSamples: null, basis: 'as stated', withheld: null };
  }

  const unit = normaliseUnit(item.unit);
  if (unit !== rule.basisUnit) {
    warnings.push(
      `Item ${item.itemNumber} is measured in "${item.unit}" but "${rule.test}" is specified per ${rule.basisUnit}. ` +
        'The frequency is shown as written; the sample count needs a conversion this generator will not guess.',
    );
    return { ...base, minimumSamples: null, basis: `per ${rule.basisUnit}`, withheld: null };
  }

  return {
    ...base,
    minimumSamples: minimumSamples(item.quantity, rule.perQuantity),
    basis: `1 per ${rule.perQuantity} ${rule.basisUnit}`,
    withheld: null,
  };
}

export function generateQcp(
  input: QcpInput,
  rulesVersion: string = QCP_RULES_VERSION,
  rules: readonly TestingRule[] = QCP_TESTING_RULES,
): GeneratorOutput {
  if (rulesVersion !== QCP_RULES_VERSION) {
    throw new Error(
      `Unknown rules version "${rulesVersion}". This generator carries ${QCP_RULES_VERSION}. ` +
        'Generating against a version that is not present would silently produce a document nobody can trace.',
    );
  }

  const warnings: string[] = [];
  const used: Provenance[] = [];
  const sections: QcpSection[] = [];

  if (input.items.length === 0) {
    warnings.push('No pay items were supplied, so this QCP covers nothing.');
  }

  for (const item of input.items) {
    const applicable = rulesForItem(item.itemNumber, rules);

    if (applicable.length === 0) {
      warnings.push(
        `No testing rules are held for Item ${item.itemNumber} (${item.description}). ` +
          'It is listed with no tests rather than omitted, so the gap is visible.',
      );
    }
    if (!(item.quantity > 0)) {
      warnings.push(`Item ${item.itemNumber} has a quantity of ${item.quantity}; no sample counts were computed.`);
    }

    const tests = applicable.map((rule) => {
      const row = rowFor(rule, item, warnings);
      if (row.withheld === null) used.push(rule.provenance);
      if (row.acceptanceCitation !== null && rule.acceptance) used.push(rule.acceptance.provenance);
      return row;
    });

    sections.push({
      itemNumber: item.itemNumber,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      tests,
    });
  }

  const notices: string[] = [
    'Frequencies are contractor quality-control frequencies. DPWH quality-assurance testing is separate and less frequent.',
  ];
  if (used.some((p) => p.caveat)) {
    notices.push(
      'Some rules are drawn from a source keyed to the 2012 edition of the Standard Specifications. ' +
        'Re-check against a current Volume II before relying on them.',
    );
  }
  if (input.mode === 'simulation') {
    notices.unshift(SIMULATION_BANNER);
  }

  const artifact: QcpArtifact = {
    title:
      input.mode === 'simulation'
        ? `${SIMULATION_MARKING.filenamePrefix}Quality Control Program — ${input.project.contractId}`
        : `Quality Control Program — ${input.project.contractId}`,
    project: input.project,
    preparedOn: input.preparedOn,
    preparedBy: input.preparedBy,
    rulesVersion,
    mode: input.mode,
    simulation: input.mode === 'simulation' ? SIMULATION_MARKING : null,
    sections,
    notices,
  };

  // Each distinct source cited once, in a stable order, so the golden file is stable.
  const provenance = [...new Map(used.map((p) => [citation(p), p])).values()].sort((a, b) =>
    citation(a).localeCompare(citation(b)),
  );

  return { artifact, warnings, provenance };
}
