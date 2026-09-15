/**
 * The ME Workflow.
 *
 * Four things over one body of vendored content: the process flows, the minimum
 * testing requirements, the study path through the training tracks, and the
 * reference library index.
 *
 * The content came across verbatim from the standalone ME Workflow — 43 steps
 * across three flows, 45 testing rows, two tracks. The rules for reading it live
 * in `workflow/content.ts`; this file is the surface.
 *
 * Two things this screen does that the standalone one could not: study-path
 * ticks are kept on the server rather than in one browser, and the testing
 * tables carry this project's own verification status beside them rather than
 * leaving a reader to guess what has been checked.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { qcpApi, quizApi, ApiError, type QcpRules, type TestingRule } from '../api';
import { loadWorkflow } from '../reviewer/load';
import {
  blankFilter,
  blankStudy,
  colourFor,
  countAllSteps,
  countRows,
  countSteps,
  countTicked,
  daysFor,
  DOMAIN_LABELS,
  emphasise,
  fileSize,
  filterFiles,
  FLOW_KEYS,
  FLOW_LABELS,
  LIBRARY_PAGE,
  missingDays,
  readInventory,
  readStudy,
  readWorkflow,
  setTick,
  tickKey,
  TRACK_LABELS,
  TRACKS,
  type FlowKey,
  type Inventory,
  type LibraryFilter,
  type StudyState,
  type Track,
  type WorkflowData,
} from '../workflow/content';
import { Action, Empty, Explain, Failed, Loading, Problem } from './bits';

type Tab = 'flows' | 'tests' | 'path' | 'library';

const TABS: { key: Tab; label: string }[] = [
  { key: 'flows', label: 'Process flows' },
  { key: 'tests', label: 'Testing requirements' },
  { key: 'path', label: 'Study path' },
  { key: 'library', label: 'Library' },
];

export default function Workflow() {
  const [data, setData] = useState<{ workflow: WorkflowData; inventory: Inventory } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const [study, setStudy] = useState<StudyState>(blankStudy());
  const [verified, setVerified] = useState<QcpRules | null>(null);
  const [tab, setTab] = useState<Tab>('flows');

  const load = useCallback(async () => {
    setError(null);
    try {
      const [raw, saved] = await Promise.all([loadWorkflow(), quizApi.get('workflow')]);
      setData({ workflow: readWorkflow(raw.workflow), inventory: readInventory(raw.inventory) });
      setStudy(readStudy(saved.progress?.state));

      /*
       * The verified rules are a bonus, not a dependency: if this call fails the
       * study tables are still perfectly readable, and failing the whole screen
       * over an annotation would be the wrong trade.
       */
      try {
        setVerified(await qcpApi.rules());
      } catch {
        setVerified(null);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* A tick is one fact and is saved as it is made — unlike a drill, there is no
     natural end of session to save at, and losing one is losing the record. */
  const tick = async (key: string, on: boolean) => {
    const next = setTick(study, key, on);
    setStudy(next);
    try {
      await quizApi.put('workflow', next as unknown as Record<string, unknown>);
    } catch (e) {
      setStudy(study); // put it back rather than show a tick the server did not take
      setProblem(e);
    }
  };

  if (error) return <Failed message={error} onRetry={() => void load()} />;
  if (!data) {
    return (
      <div className="view">
        <header className="vhead">
          <h1>ME Workflow</h1>
        </header>
        <Explain>Fetching the workflow content and the file index. This happens once per visit.</Explain>
        <Loading />
      </div>
    );
  }

  const { workflow, inventory } = data;

  return (
    <div className="view">
      <header className="vhead">
        <h1>ME Workflow</h1>
        <span className="q">
          {countAllSteps(workflow.FLOWS)} steps · {countRows(workflow.MATS)} testing rows ·{' '}
          {inventory.totalFiles.toLocaleString()} files
        </span>
      </header>

      <Problem error={problem} onDismiss={() => setProblem(null)} />

      <nav className="tabbar" aria-label="Workflow sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`btn ${tab === t.key ? 'btn-primary' : 'btn-secondary'}`}
            aria-current={tab === t.key ? 'page' : undefined}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'flows' && <Flows data={workflow} />}
      {tab === 'tests' && <Tests data={workflow} verified={verified} />}
      {tab === 'path' && <Path data={workflow} inventory={inventory} study={study} onTick={tick} />}
      {tab === 'library' && <Library inventory={inventory} />}
    </div>
  );
}

/* --------------------------------------------------------------- flows --- */

function Flows({ data }: { data: WorkflowData }) {
  const [flow, setFlow] = useState<FlowKey>('materials');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const meta = data.FLOW_META[flow];
  const phases = data.FLOWS[flow] ?? [];

  if (!meta) return <Empty title="That flow is not in the content." body="The vendored data may be out of date." />;

  let n = 0;

  return (
    <>
      <nav className="tabbar" aria-label="Flows">
        {FLOW_KEYS.map((k) => (
          <button
            key={k}
            className={`btn ${flow === k ? 'btn-primary' : 'btn-secondary'}`}
            aria-current={flow === k ? 'page' : undefined}
            onClick={() => setFlow(k)}
          >
            {FLOW_LABELS[k]}
          </button>
        ))}
      </nav>

      <div className="card">
        {/* Authored prose. Its emphasis is kept; no HTML is handed to the DOM. */}
        <p className="flowintro">
          {emphasise(meta.intro).map((part, i) => (part.bold ? <b key={i}>{part.text}</b> : <span key={i}>{part.text}</span>))}
        </p>
        <div className="legend">
          {meta.legend.map(([colour, label]) => (
            <span key={label}>
              <i style={{ background: colour }} aria-hidden="true" />
              {label}
            </span>
          ))}
        </div>
        <div className="q nextnote">
          {phases.length} phases · {countSteps(phases)} steps
        </div>
      </div>

      {phases.map((phase) => (
        <div className="card" key={phase.ph}>
          <div className="mastery-head">
            <h2 className="h2">{phase.ph}</h2>
            <span className="q">{phase.when}</span>
          </div>

          {phase.steps.map((step) => {
            const id = `${flow}${n++}`;
            const shown = open[id] === true;
            return (
              <div key={id} className="step" style={{ borderLeftColor: colourFor(meta, step.r) }}>
                <button
                  className="stepbtn"
                  aria-expanded={shown}
                  onClick={() => setOpen({ ...open, [id]: !shown })}
                >
                  <span>
                    <b>{step.t}</b>
                    <span className="q steprole">{meta.labels[step.r] ?? step.r}</span>
                  </span>
                  <span className="q" aria-hidden="true">
                    {shown ? '−' : '+'}
                  </span>
                </button>

                {shown && (
                  <div className="stepbody">
                    <p>{step.d}</p>
                    <div className="steppair">
                      <div>
                        <span className="lbl q">Responsible</span>
                        <b>{step.who}</b>
                      </div>
                      <div>
                        <span className="lbl q">Output</span>
                        <b>{step.out}</b>
                      </div>
                    </div>
                    {step.note && (
                      <div className="card worthknowing">
                        <b>Worth knowing</b>
                        <p className="q">{step.note}</p>
                      </div>
                    )}
                    {step.refs && step.refs.length > 0 && (
                      <div className="reflist">
                        {step.refs.map((r) => (
                          <span className="pill" key={r}>
                            {r}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

/* --------------------------------------------------------------- tests --- */

function Tests({ data, verified }: { data: WorkflowData; verified: QcpRules | null }) {
  return (
    <>
      <div className="card">
        <h2 className="h2">Minimum testing requirements</h2>
        <Explain>
          Test, method, sampling frequency and the requirement, across {data.MATS.length} material groups. These are{' '}
          <b>Tier 0</b> — reviewer and lecture material. They are here to study from, not to certify from: confirm a
          value against the DPWH Standard Specifications before it goes on a document.
        </Explain>
        <p className="q nextnote">
          The QCP generator does not read this table. Its acceptance limits are verified against the source PDF and
          carry their own citation, precisely so a study aid can never become the authority for an issued document.
        </p>
      </div>

      {verified && <Verified rules={verified} />}

      {data.MATS.map((m) => (
        <div className="card" key={m.id}>
          <div className="mastery-head">
            <h2 className="h2">
              <span aria-hidden="true">{m.ic}</span> {m.n}
            </h2>
            <span className="q">{m.s}</span>
          </div>

          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Method</th>
                  <th>Frequency</th>
                  <th>Requirement</th>
                </tr>
              </thead>
              <tbody>
                {m.rows.map((row) => (
                  <tr key={row.join('|')}>
                    {row.map((cell, i) => (
                      <td key={i} className={i === 1 ? 'mono' : undefined}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {m.note && <p className="q nextnote">{m.note}</p>}
        </div>
      ))}
    </>
  );
}

/**
 * What this project has actually verified, beside what the study tables say.
 *
 * The tables above are lecture material and at least one of their notes is now
 * out of date — the Item 200 soaked CBR is recorded there as unresolved between
 * editions, and it was settled from the 2013 Standard Specifications held in the
 * vault. The settled value is not copied here: it is served from the same record
 * the generator uses, so the two cannot drift apart.
 *
 * Only rules carrying an acceptance limit are listed. A frequency with no limit
 * read from a source is not a verification of anything.
 */
function Verified({ rules }: { rules: QcpRules }) {
  const withLimits = rules.rules.filter((r): r is TestingRule & { acceptance: NonNullable<TestingRule['acceptance']> } =>
    r.acceptance !== undefined,
  );
  // The hook comes before any early return — a hook that runs on some renders
  // and not others is the classic way to desynchronise React's hook order.
  const [open, setOpen] = useState(false);

  if (withLimits.length === 0) return null;
  const { caveat, countersignedBy, countersignedOn } = withLimits[0].acceptance.provenance;

  return (
    <div className="card verified">
      <div className="mastery-head">
        <h2 className="h2">Verified by this project</h2>
        <span className="pill">tier 1</span>
      </div>
      <p className="q">
        {withLimits.length} acceptance limits across items {rules.items.join(', ')}, read from the source document and
        cited section by section. <b>Where one of these differs from a table above, this is the one to trust.</b> The
        generator reads exactly this record — nothing here is a second copy of a value.
      </p>
      <p className="q nextnote">
        {countersignedBy ? (
          <>
            Countersigned by {countersignedBy} on {countersignedOn} — these may be cited on an issued document.
          </>
        ) : (
          <>Not yet countersigned — read these against your own copy before citing one.</>
        )}
        {caveat && ` (${caveat}.)`}
      </p>

      <div className="actions">
        <Action label={open ? 'Hide the limits' : `Show the ${withLimits.length} limits`} onClick={() => setOpen(!open)} />
      </div>

      {open && (
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Test</th>
                <th>Requirement</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {withLimits.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.item}</td>
                  <td>{r.test}</td>
                  <td>{r.acceptance.requirement}</td>
                  <td className="q">
                    {r.acceptance.provenance.sourceDocument} ({r.acceptance.provenance.sourceYear}){' '}
                    <span className="mono">{r.acceptance.provenance.sourceSection}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- study path --- */

function Path({
  data,
  inventory,
  study,
  onTick,
}: {
  data: WorkflowData;
  inventory: Inventory;
  study: StudyState;
  onTick: (key: string, on: boolean) => void;
}) {
  const [track, setTrack] = useState<Track>('MTT');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const labels = data.DAYS[track] ?? {};
  const days = useMemo(() => daysFor(inventory, track, labels), [inventory, track, labels]);
  const gaps = useMemo(() => missingDays(inventory, track, labels), [inventory, track, labels]);
  const done = countTicked(study, track, days);
  const files = days.reduce((a, d) => a + d.files.length, 0);

  return (
    <>
      <nav className="tabbar" aria-label="Tracks">
        {TRACKS.map((t) => (
          <button
            key={t}
            className={`btn ${track === t ? 'btn-primary' : 'btn-secondary'}`}
            aria-current={track === t ? 'page' : undefined}
            onClick={() => setTrack(t)}
          >
            {TRACK_LABELS[t]}
          </button>
        ))}
      </nav>

      <div className="card">
        {/*
          The vendored intro ends "progress is saved in this browser only", which
          was true of the standalone file and is not true here. The data file is
          not edited, so this screen states the position itself.
        */}
        <Explain>
          {track === 'MTT'
            ? 'Your MTT training sequence, with the files belonging to each day.'
            : 'The Comprehensive Course for Field Engineers — four modules across sixteen days. Days 13–16 are the quality-assurance module that feeds the Materials QC/QA flow.'}{' '}
          Tick a day when you have reviewed it. Ticks are kept on the server, so they survive a cleared browser and
          follow you to another machine.
        </Explain>

        <div className="cards">
          <div>
            <div className="lbl q">Days with files</div>
            <div className="figure">{days.length}</div>
          </div>
          <div>
            <div className="lbl q">Reviewed</div>
            <div className="figure">{done}</div>
          </div>
          <div>
            <div className="lbl q">Files in this track</div>
            <div className="figure">{files.toLocaleString()}</div>
          </div>
        </div>

        <div className="meter" style={{ marginTop: 12 }}>
          <i style={{ width: `${days.length ? (done / days.length) * 100 : 0}%` }} />
        </div>

        {gaps.length > 0 && (
          <p className="q nextnote">
            Day{gaps.length === 1 ? '' : 's'} {gaps.join(', ')} {gaps.length === 1 ? 'is' : 'are'} in the syllabus but{' '}
            {gaps.length === 1 ? 'has' : 'have'} no files in the index. Nothing was invented to fill{' '}
            {gaps.length === 1 ? 'it' : 'them'}.
          </p>
        )}
      </div>

      {days.length === 0 ? (
        <Empty
          title="No days in the index for this track."
          body="The index is built by scan.ps1 against the reference library. A track with no dated files has nothing to list."
        />
      ) : (
        days.map((d) => {
          const key = tickKey(track, d.day);
          const ticked = study.days[key] === 1;
          const shown = open[key] === true;
          return (
            <div className={`card day${ticked ? ' day-done' : ''}`} key={key}>
              <div className="mastery-head">
                <label className="daytick">
                  <input type="checkbox" checked={ticked} onChange={(e) => onTick(key, e.target.checked)} />
                  <b>
                    Day {d.day}
                    {d.label ? ` — ${d.label}` : ''}
                  </b>
                </label>
                <span className="q">
                  {d.files.length} file{d.files.length === 1 ? '' : 's'}
                </span>
                <Action label={shown ? 'Hide' : 'Files'} onClick={() => setOpen({ ...open, [key]: !shown })} />
              </div>

              {shown && (
                <div className="scroll-x">
                  <table>
                    <tbody>
                      {d.files.map((f) => (
                        <tr key={f.p}>
                          <td>
                            <b>{f.n}</b>
                            <div className="q mono srcline">{f.p}</div>
                          </td>
                          <td className="mono">{fileSize(f.s)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })
      )}
    </>
  );
}

/* -------------------------------------------------------------- library --- */

function Library({ inventory }: { inventory: Inventory }) {
  const [filter, setFilter] = useState<LibraryFilter>(blankFilter());
  const rows = useMemo(() => filterFiles(inventory.files, filter), [inventory.files, filter]);
  const set = (k: keyof LibraryFilter, v: string) => setFilter({ ...filter, [k]: v });

  /*
   * `names` is passed only where there is a map for that facet. Applying the
   * domain names to every select relabelled the `other` *kind* as "Other" while
   * its neighbours stayed lowercase — one facet's vocabulary leaking into
   * another's.
   */
  const select = (
    k: keyof LibraryFilter,
    label: string,
    counts: Record<string, number>,
    names?: Record<string, string>,
  ) => (
    <div className="field">
      <label htmlFor={`lib-${k}`}>{label}</label>
      <select id={`lib-${k}`} className="input" value={filter[k]} onChange={(e) => set(k, e.target.value)}>
        <option value="">All</option>
        {Object.entries(counts).map(([v, n]) => (
          <option key={v} value={v}>
            {names?.[v] ?? v} ({n})
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <>
      <div className="card">
        <h2 className="h2">Library</h2>
        <Explain>
          {inventory.totalFiles.toLocaleString()} files, {fileSize(inventory.totalBytes)}. The index was generated{' '}
          {inventory.generated} by <span className="mono">scan.ps1</span>, which is read-only by design — this screen
          lists what is on disk and never touches it.
        </Explain>

        <div className="filters">
          <div className="field">
            <label htmlFor="lib-q">Search</label>
            <input
              id="lib-q"
              className="input"
              value={filter.q}
              placeholder="name or folder"
              onChange={(e) => set('q', e.target.value)}
            />
          </div>
          {select('domain', 'Domain', inventory.byDomain, DOMAIN_LABELS)}
          {select('track', 'Track', inventory.byTrack)}
          {select('kind', 'Kind', inventory.byKind)}
        </div>

        <p className="q nextnote" role="status">
          {rows.length.toLocaleString()} of {inventory.totalFiles.toLocaleString()} shown
          {rows.length > LIBRARY_PAGE && ` — the first ${LIBRARY_PAGE} are listed`}
        </p>
      </div>

      {rows.length === 0 ? (
        <Empty title="Nothing matches those filters." body="Clear the search or widen a filter." />
      ) : (
        <div className="card">
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Track</th>
                  <th>Kind</th>
                  <th>Type</th>
                  <th>Size</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, LIBRARY_PAGE).map((f) => (
                  <tr key={f.p}>
                    <td>
                      <b>{f.n}</b>
                      <div className="q mono srcline">{f.p}</div>
                    </td>
                    <td>{f.t}</td>
                    <td>{f.k}</td>
                    <td className="mono">{f.x}</td>
                    <td className="mono">{fileSize(f.s)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
