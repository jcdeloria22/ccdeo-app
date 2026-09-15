/**
 * The Workflow's content, and the rules for reading it.
 *
 * `workflow-data.js` and `inventory.js` are vendored byte-identically and arrive
 * as untyped globals. Everything that decides what the screen shows — which
 * training days exist, which are named but missing, how a file list is filtered,
 * how far through a track someone is — lives here as pure functions, so it can
 * be tested without a DOM and cannot drift into the markup.
 *
 * Nothing here edits the vendored content. Where this project knows something
 * the vendored copy does not, it is added alongside and attributed, never
 * written over the source.
 */

export interface Step {
  /** Role key — 'qc', 'qa', 'doc', 'plan', 'field', 'lab', 'fail'… */
  r: string;
  t: string;
  d: string;
  who: string;
  out: string;
  note?: string;
  refs?: string[];
}

export interface Phase {
  ph: string;
  when: string;
  steps: Step[];
}

export interface FlowMeta {
  intro: string;
  legend: [string, string][];
  labels: Record<string, string>;
}

export interface MaterialGroup {
  id: string;
  ic: string;
  n: string;
  s: string;
  rows: string[][];
  note?: string;
}

export interface WorkflowData {
  FLOW_META: Record<string, FlowMeta>;
  FLOWS: Record<string, Phase[]>;
  MATS: MaterialGroup[];
  DAYS: Record<string, Record<number, string>>;
  STUDY_INTRO: Record<string, string>;
}

export interface IndexedFile {
  /** Path, name, track, group, extension, domain, material, kind, size, date, day. */
  p: string;
  n: string;
  t: string;
  g: string;
  x: string;
  dm: string;
  m: string;
  k: string;
  s: number;
  d: string;
  day: number;
}

export interface Inventory {
  generated: string;
  root: string;
  totalFiles: number;
  totalBytes: number;
  byDomain: Record<string, number>;
  byTrack: Record<string, number>;
  byMaterial: Record<string, number>;
  byKind: Record<string, number>;
  byExt: Record<string, number>;
  files: IndexedFile[];
}

export const FLOW_KEYS = ['materials', 'geotech', 'pe'] as const;
export type FlowKey = (typeof FLOW_KEYS)[number];

export const FLOW_LABELS: Record<FlowKey, string> = {
  materials: 'Materials QC/QA',
  geotech: 'Geotechnical investigation',
  pe: 'Project lifecycle',
};

export const TRACKS = ['MTT', 'PE'] as const;
export type Track = (typeof TRACKS)[number];

export const TRACK_LABELS: Record<Track, string> = {
  MTT: 'MTT',
  PE: 'PE Field Engineer Compre',
};

export const DOMAIN_LABELS: Record<string, string> = {
  materials: 'Materials',
  projectdev: 'Project development',
  policy: 'Policy',
  research: 'Research',
  other: 'Other',
};

/**
 * The vendored globals, checked rather than trusted.
 *
 * A script that loaded but defined something unexpected should say so here,
 * where the message can name the file, rather than throw further in as an
 * undefined property inside the render.
 */
export function readWorkflow(raw: unknown): WorkflowData {
  const d = raw as Partial<WorkflowData> | null;
  if (!d || typeof d !== 'object' || !d.FLOWS || !d.FLOW_META || !Array.isArray(d.MATS)) {
    throw new Error('workflow-data.js loaded but did not define the expected content.');
  }
  return { ...d, DAYS: d.DAYS ?? {}, STUDY_INTRO: d.STUDY_INTRO ?? {} } as WorkflowData;
}

export function readInventory(raw: unknown): Inventory {
  const i = raw as Partial<Inventory> | null;
  if (!i || typeof i !== 'object' || !Array.isArray(i.files)) {
    throw new Error('inventory.js loaded but did not define a file list.');
  }
  return {
    generated: i.generated ?? 'unknown',
    root: i.root ?? '',
    totalFiles: i.totalFiles ?? i.files.length,
    totalBytes: i.totalBytes ?? 0,
    byDomain: i.byDomain ?? {},
    byTrack: i.byTrack ?? {},
    byMaterial: i.byMaterial ?? {},
    byKind: i.byKind ?? {},
    byExt: i.byExt ?? {},
    files: i.files,
  };
}

/**
 * The authored emphasis in a flow's intro, without handing HTML to the DOM.
 *
 * The intros carry `<b>` and nothing else — the whole vendored file contains
 * four tags, all of them bold. Splitting on them keeps the emphasis the author
 * put there while making `dangerouslySetInnerHTML` unnecessary: if the vendored
 * content ever did change, the worst case is visible angle brackets rather than
 * markup running in the page.
 */
export function emphasise(html: string): { text: string; bold: boolean }[] {
  return html
    .split(/<b>|<\/b>/)
    .map((text, i) => ({ text: text.replace(/\s+/g, ' '), bold: i % 2 === 1 }))
    .filter((part) => part.text !== '');
}

export function countSteps(flow: Phase[]): number {
  return flow.reduce((a, p) => a + p.steps.length, 0);
}

export function countAllSteps(flows: Record<string, Phase[]>): number {
  return Object.values(flows).reduce((a, f) => a + countSteps(f), 0);
}

export function countRows(mats: MaterialGroup[]): number {
  return mats.reduce((a, m) => a + m.rows.length, 0);
}

/** The colour the flow's own legend gives a role, so the key on screen matches the bars. */
export function colourFor(meta: FlowMeta, role: string): string {
  const label = (meta.labels[role] ?? '').toLowerCase().split(' ')[0];
  if (!label) return 'var(--color-brand-700)';
  const hit = meta.legend.find(([, l]) => l.toLowerCase().includes(label));
  return hit ? hit[0] : 'var(--color-brand-700)';
}

export function fileSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/* ------------------------------------------------------------ study path --- */

export interface StudyDay {
  day: number;
  label: string | null;
  files: IndexedFile[];
}

/**
 * The days of a track that actually have files behind them.
 *
 * Driven off the index rather than the syllabus, because a day with nothing in
 * it is not something to tick off. The days the syllabus names but the index
 * cannot fill are reported separately by `missingDays` — said out loud rather
 * than quietly dropped, and never invented to round the list out.
 */
export function daysFor(inv: Inventory, track: Track, labels: Record<number, string>): StudyDay[] {
  const mine = inv.files.filter((f) => f.t === track && f.day > 0);
  const present = [...new Set(mine.map((f) => f.day))].sort((a, b) => a - b);
  return present.map((day) => ({
    day,
    label: labels[day] ?? null,
    files: mine.filter((f) => f.day === day),
  }));
}

export function missingDays(inv: Inventory, track: Track, labels: Record<number, string>): number[] {
  const present = new Set(daysFor(inv, track, labels).map((d) => d.day));
  return Object.keys(labels)
    .map(Number)
    .filter((n) => Number.isFinite(n) && !present.has(n))
    .sort((a, b) => a - b);
}

/** A tick is stored per track and per day, so two tracks cannot overwrite each other. */
export function tickKey(track: Track, day: number): string {
  return `${track}-${day}`;
}

export interface StudyState {
  days: Record<string, 1>;
}

export function blankStudy(): StudyState {
  return { days: {} };
}

export function readStudy(state: unknown): StudyState {
  const s = state as Partial<StudyState> | null;
  if (!s || typeof s !== 'object' || !s.days || typeof s.days !== 'object') return blankStudy();
  return { days: { ...s.days } };
}

/** Returns a new record; the one passed in is untouched. */
export function setTick(study: StudyState, key: string, on: boolean): StudyState {
  const days = { ...study.days };
  if (on) days[key] = 1;
  else delete days[key];
  return { days };
}

export function countTicked(study: StudyState, track: Track, days: StudyDay[]): number {
  return days.filter((d) => study.days[tickKey(track, d.day)]).length;
}

/* -------------------------------------------------------------- library --- */

export interface LibraryFilter {
  q: string;
  domain: string;
  track: string;
  kind: string;
}

export function blankFilter(): LibraryFilter {
  return { q: '', domain: '', track: '', kind: '' };
}

/**
 * The library list.
 *
 * Every filter is an AND, and the search matches the name or the path — a
 * folder name is often the only thing distinguishing two identically-named
 * scans. An empty filter means "no restriction", never "match nothing".
 */
export function filterFiles(files: IndexedFile[], f: LibraryFilter): IndexedFile[] {
  const q = f.q.trim().toLowerCase();
  return files.filter(
    (file) =>
      (!f.domain || file.dm === f.domain) &&
      (!f.track || file.t === f.track) &&
      (!f.kind || file.k === f.kind) &&
      (!q || `${file.n} ${file.p}`.toLowerCase().includes(q)),
  );
}

/** How many rows the table draws. The rest are counted, not rendered. */
export const LIBRARY_PAGE = 300;
