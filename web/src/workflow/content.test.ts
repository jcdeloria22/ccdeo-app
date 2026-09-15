/**
 * Reading the workflow content.
 *
 * The content itself is vendored and proven by use; what is tested here is the
 * reading of it — that a day with no files behind it is never offered as
 * something to tick, that a day the syllabus names but the index cannot fill is
 * reported rather than dropped or invented, that a filter with nothing set means
 * "everything" and not "nothing", and that a tick belongs to one track.
 */
import { describe, it, expect } from 'vitest';
import {
  blankFilter,
  blankStudy,
  colourFor,
  countAllSteps,
  countRows,
  countSteps,
  countTicked,
  daysFor,
  emphasise,
  fileSize,
  filterFiles,
  missingDays,
  readInventory,
  readStudy,
  readWorkflow,
  setTick,
  tickKey,
  type IndexedFile,
  type Inventory,
  type Phase,
} from './content';

const file = (over: Partial<IndexedFile> = {}): IndexedFile => ({
  p: 'MTT\\Day 1\\deck.pdf',
  n: 'deck.pdf',
  t: 'MTT',
  g: 'Day 1',
  x: 'pdf',
  dm: 'materials',
  m: 'soils',
  k: 'lecture',
  s: 1_048_576,
  d: '2026-08-26',
  day: 1,
  ...over,
});

const inv = (files: IndexedFile[]): Inventory =>
  readInventory({ generated: '2026-08-26 20:01', totalFiles: files.length, totalBytes: 0, files });

const phases: Phase[] = [
  { ph: 'Desk study', when: 'Before mobilization', steps: [
    { r: 'plan', t: 'Literature review', d: '', who: 'Geotech', out: 'Data' },
    { r: 'plan', t: 'Recon', d: '', who: 'Geotech', out: 'Notes' },
  ] },
  { ph: 'Field', when: 'On site', steps: [{ r: 'field', t: 'SPT', d: '', who: 'Crew', out: 'N-values' }] },
];

describe('reading the vendored globals', () => {
  it('refuses content that loaded but is not what was expected', () => {
    expect(() => readWorkflow(null)).toThrow(/workflow-data\.js/);
    expect(() => readWorkflow({ FLOWS: {} })).toThrow(/workflow-data\.js/);
    expect(() => readInventory({ totalFiles: 9 })).toThrow(/inventory\.js/);
  });

  it('names the file in the message, so the fix is obvious', () => {
    expect(() => readInventory(undefined)).toThrow(/did not define a file list/);
  });

  it('fills in what an older index may not carry, rather than rendering undefined', () => {
    const i = readInventory({ files: [file()] });
    expect(i.totalFiles).toBe(1);
    expect(i.generated).toBe('unknown');
    expect(i.byDomain).toEqual({});
  });
});

describe('counting', () => {
  it('counts steps across a flow and across all of them', () => {
    expect(countSteps(phases)).toBe(3);
    expect(countAllSteps({ a: phases, b: phases })).toBe(6);
  });

  it('counts testing rows, not material groups', () => {
    expect(countRows([{ id: 'x', ic: '', n: '', s: '', rows: [['a'], ['b']] }])).toBe(2);
  });
});

describe('the legend colour', () => {
  const meta = {
    intro: '',
    legend: [['var(--blu)', 'Contractor QC'], ['var(--grn)', 'DPWH QA']] as [string, string][],
    labels: { qc: 'Contractor QC', qa: 'DPWH QA' },
  };

  it('is the one the flow’s own legend gives that role', () => {
    expect(colourFor(meta, 'qc')).toBe('var(--blu)');
    expect(colourFor(meta, 'qa')).toBe('var(--grn)');
  });

  /** A role with no legend entry gets the neutral rule, not a wrong colour. */
  it('falls back rather than borrowing another role’s colour', () => {
    expect(colourFor(meta, 'nope')).toBe('var(--color-brand-700)');
    expect(colourFor({ ...meta, labels: {} }, 'qc')).toBe('var(--color-brand-700)');
  });
});

describe('the authored emphasis', () => {
  it('keeps the bold the author put there, as text rather than markup', () => {
    expect(emphasise('Quality Control is the <b>contractor</b> responsibility.')).toEqual([
      { text: 'Quality Control is the ', bold: false },
      { text: 'contractor', bold: true },
      { text: ' responsibility.', bold: false },
    ]);
  });

  it('collapses the line breaks in the source template literals', () => {
    expect(emphasise('one\n    two')).toEqual([{ text: 'one two', bold: false }]);
  });

  it('leaves anything else as visible text, never as markup', () => {
    const parts = emphasise('before <script>alert(1)</script> after');
    expect(parts).toHaveLength(1);
    expect(parts[0].bold).toBe(false);
    expect(parts[0].text).toContain('<script>');
  });
});

describe('file sizes', () => {
  it('reads in the unit a person would use', () => {
    expect(fileSize(512)).toBe('512 B');
    expect(fileSize(2048)).toBe('2 KB');
    expect(fileSize(1_048_576)).toBe('1.0 MB');
    expect(fileSize(3_590_726_846)).toBe('3.3 GB');
  });
});

describe('the study path', () => {
  const labels = { 1: 'Sampling', 2: 'Concrete', 5: 'Acceptance' };

  const files = [
    file({ day: 1, p: 'a', n: 'a.pdf' }),
    file({ day: 1, p: 'b', n: 'b.pdf' }),
    file({ day: 2, p: 'c', n: 'c.pdf' }),
    file({ day: 0, p: 'undated', n: 'undated.pdf' }),
    file({ day: 3, t: 'PE', p: 'pe', n: 'pe.pdf' }),
  ];

  it('lists only the days that have files, in order', () => {
    const days = daysFor(inv(files), 'MTT', labels);
    expect(days.map((d) => d.day)).toEqual([1, 2]);
    expect(days[0].files).toHaveLength(2);
  });

  it('leaves out undated files rather than filing them under day zero', () => {
    expect(daysFor(inv(files), 'MTT', labels).some((d) => d.day === 0)).toBe(false);
  });

  it('keeps one track out of another', () => {
    expect(daysFor(inv(files), 'PE', {}).map((d) => d.day)).toEqual([3]);
  });

  it('carries the label where there is one, and null rather than a guess where there is not', () => {
    const days = daysFor(inv([file({ day: 1 }), file({ day: 9, p: 'z', n: 'z.pdf' })]), 'MTT', labels);
    expect(days[0].label).toBe('Sampling');
    expect(days[1].label).toBeNull();
  });

  /**
   * Day 5 is in the syllabus and has nothing behind it. Saying so is the point —
   * the standalone reviewer's habit of quietly dropping such a day is how a gap
   * in the library becomes invisible.
   */
  it('names the days the syllabus has but the index cannot fill', () => {
    expect(missingDays(inv(files), 'MTT', labels)).toEqual([5]);
  });

  it('reports no gap when every named day has files', () => {
    expect(missingDays(inv([file({ day: 1 })]), 'MTT', { 1: 'Sampling' })).toEqual([]);
  });
});

describe('ticking a day off', () => {
  it('keys a tick to its track, so two tracks cannot overwrite each other', () => {
    expect(tickKey('MTT', 3)).toBe('MTT-3');
    expect(tickKey('PE', 3)).toBe('PE-3');
  });

  it('sets and clears, and leaves the record it was given untouched', () => {
    const before = blankStudy();
    const on = setTick(before, 'MTT-1', true);
    expect(on.days['MTT-1']).toBe(1);
    expect(before.days).toEqual({});

    const off = setTick(on, 'MTT-1', false);
    expect(off.days['MTT-1']).toBeUndefined();
    expect(on.days['MTT-1'], 'the earlier record must not have been mutated').toBe(1);
  });

  it('counts only the days actually on screen for that track', () => {
    const study = { days: { 'MTT-1': 1 as const, 'MTT-9': 1 as const, 'PE-1': 1 as const } };
    const days = daysFor(inv([file({ day: 1 }), file({ day: 2, p: 'b', n: 'b.pdf' })]), 'MTT', {});
    // MTT-9 is ticked but has no day on screen; PE-1 belongs to the other track.
    expect(countTicked(study, 'MTT', days)).toBe(1);
  });

  it('survives a stored record from before this shape existed', () => {
    expect(readStudy(null)).toEqual({ days: {} });
    expect(readStudy({})).toEqual({ days: {} });
    expect(readStudy({ days: { 'MTT-1': 1 } }).days['MTT-1']).toBe(1);
  });
});

describe('the library filter', () => {
  const files = [
    file({ p: 'MTT\\soils.pdf', n: 'soils.pdf', dm: 'materials', t: 'MTT', k: 'lecture' }),
    file({ p: 'PE\\contracts.pdf', n: 'contracts.pdf', dm: 'projectdev', t: 'PE', k: 'reviewer' }),
    file({ p: 'Issuances\\DO 075.pdf', n: 'DO 075.pdf', dm: 'policy', t: 'DPWH Issuances', k: 'issuance' }),
  ];

  it('shows everything when nothing is set', () => {
    expect(filterFiles(files, blankFilter())).toHaveLength(3);
  });

  it('narrows on each facet, and combines them', () => {
    expect(filterFiles(files, { ...blankFilter(), domain: 'policy' })).toHaveLength(1);
    expect(filterFiles(files, { ...blankFilter(), track: 'MTT' })).toHaveLength(1);
    expect(filterFiles(files, { ...blankFilter(), kind: 'issuance' })).toHaveLength(1);
    expect(filterFiles(files, { ...blankFilter(), domain: 'policy', track: 'MTT' })).toHaveLength(0);
  });

  it('searches the folder as well as the name', () => {
    expect(filterFiles(files, { ...blankFilter(), q: 'issuances' })).toHaveLength(1);
    expect(filterFiles(files, { ...blankFilter(), q: 'DO 075' })).toHaveLength(1);
  });

  it('ignores case and surrounding space, which is how a search is actually typed', () => {
    expect(filterFiles(files, { ...blankFilter(), q: '  SOILS  ' })).toHaveLength(1);
  });

  it('finds nothing rather than everything when nothing matches', () => {
    expect(filterFiles(files, { ...blankFilter(), q: 'zzzz' })).toHaveLength(0);
  });
});
