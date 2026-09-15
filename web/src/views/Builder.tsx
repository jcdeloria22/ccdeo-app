/**
 * The Document Builder.
 *
 * Reads a BAC abstract of bids and writes the paperwork that follows from it —
 * resolutions and notices of post-qualification, from the office's own .docx
 * templates. The layers underneath are vendored byte-identically from the build
 * that was proven to reproduce 43 real resolutions exactly; this file is only the
 * surface.
 *
 * Two things it does that the standalone Builder could not:
 *
 *   - it loads on demand. ~4 MB of libraries and 15 MB of text recognition are
 *     fetched when this tab is opened, or when a scanned PDF actually needs
 *     recognising, rather than sitting in every page load.
 *   - what it builds can be filed. Each document can be downloaded, put into a
 *     contract's slot in the register, or both — which is the point of the two
 *     halves being one application.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadBuilder, loadOcr, OCR_PATHS, type Builder as Kit } from '../builder/load';
import { registerApi, uploadToSlot, writeApi, type Project, type ProjectSlot } from '../api';
import { Action, Explain, Loading, Panel, Problem } from './bits';
import { Letters, Setup } from './BuilderSetup';
import { settingsApi } from '../api';

interface Contract {
  contractId?: string;
  name?: string;
  bidders?: unknown[];
  [k: string]: unknown;
}

interface Built {
  /** Path inside the zip, which is also the filename. */
  path: string;
  name: string;
  blob: Blob;
  contractId: string;
  kind: string;
  filedAs?: string;
}

/** What the vendored helpers expect handed to them on every call. */
function blankState(kit: Kit) {
  return {
    contracts: [] as Contract[],
    items: [],
    files: {} as Record<string, File>,
    templates: kit.templates,
    warnings: [] as string[],
    contractors: kit.contractors,
    holidays: [] as string[],
    letters: { letterDate: '', prebidDate: '', openingDate: '', folder: '' },
    sig: { chair: '', vice: '', de: '', so: '' },
    want: { res: true, notice: true, sheet: true },
    tab: 'pairs',
    log: [] as string[],
  };
}

export default function Builder() {
  const [kit, setKit] = useState<Kit | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [log, setLog] = useState<string[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [built, setBuilt] = useState<Built[]>([]);
  const [problem, setProblem] = useState<unknown>(null);
  const [want, setWant] = useState({ res: true, notice: true, sheet: true });
  const [paste, setPaste] = useState('');
  const [reading, setReading] = useState(false);
  const [pane, setPane] = useState<'build' | 'letters' | 'setup'>('build');

  /* Held here, not in Setup, because the letters need them to work out the
     working-day schedule and the two panes must not disagree. */
  const [holidays, setHolidays] = useState<string[]>([]);
  const state = useRef<ReturnType<typeof blankState> | null>(null);

  const say = useCallback((line: string) => setLog((l) => [...l, line]), []);

  useEffect(() => {
    settingsApi
      .get<string[]>('builder.holidays')
      .then((r) => setHolidays(r.setting?.value ?? []))
      .catch(() => {
        /* the Setup pane reports it; the build flow does not need them */
      });
  }, []);

  useEffect(() => {
    loadBuilder()
      .then((k) => {
        setKit(k);
        state.current = blankState(k);
        say(`ready — ${Object.keys(k.templates).length} templates loaded`);
      })
      .catch(setLoadError);
  }, [say]);

  const sync = () => {
    if (!kit || !state.current) return null;
    state.current.contracts = contracts;
    state.current.want = want;
    (kit.core.setState as (s: unknown) => void)(state.current);
    return state.current;
  };

  /* ------------------------------------------------------------- reading --- */

  const readAbstract = async (file: File) => {
    if (!kit) return;
    setProblem(null);
    setReading(true);
    say(`reading ${file.name}…`);
    try {
      const buf = await file.arrayBuffer();
      const hasText = await (kit.extract.hasTextLayer as (b: ArrayBuffer, p: unknown) => Promise<boolean>)(
        buf,
        kit.pdfjsLib,
      );

      let pages: unknown;
      if (hasText) {
        say('text layer found — no recognition needed');
        pages = await (kit.extract.pdfTextPages as (b: ArrayBuffer, p: unknown) => Promise<unknown>)(buf, kit.pdfjsLib);
      } else {
        say('scanned pages — fetching text recognition (about 15 MB, once)');
        const tesseract = await loadOcr();
        say('recognising — this takes a minute or two');
        pages = await (
          kit.extract.pdfOcrPages as (
            b: ArrayBuffer,
            p: unknown,
            t: unknown,
            cb: (m: { status?: string; progress?: number }) => void,
            paths?: unknown,
          ) => Promise<unknown>
        )(
          buf,
          kit.pdfjsLib,
          tesseract,
          (m) => {
            if (m?.status) say(m.status + (m.progress ? ` ${Math.round(m.progress * 100)}%` : ''));
          },
          OCR_PATHS,
        );
      }

      const s = sync();
      const found =
        ((kit.extract.parseAbstract as (p: unknown, c: unknown) => Contract[])(pages, kit.contractors) as Contract[]) ??
        [];
      found.forEach((c) => (kit.core.mergeContract as (c: Contract) => void)(c));
      setContracts([...(s?.contracts ?? [])]);
      say(`${found.length} contract(s) read`);
    } catch (e) {
      setProblem(e);
      say(`could not read that file: ${(e as Error).message}`);
    } finally {
      setReading(false);
    }
  };

  const applyPaste = () => {
    if (!kit) return;
    const s = sync();
    const rows = (kit.core.parsePasted as (t: string) => Contract[])(paste);
    if (!rows?.length) {
      setProblem(new Error('Nothing readable in that paste. Expect one contract per line, tab or comma separated.'));
      return;
    }
    rows.forEach((r) => (kit.core.mergeContract as (c: Contract) => void)(r));
    setContracts([...(s?.contracts ?? [])]);
    say(`${rows.length} row(s) pasted`);
    setPaste('');
  };

  /* -------------------------------------------------------------- building --- */

  const build = async () => {
    if (!kit) return;
    setProblem(null);
    const s = sync();
    if (!s) return;

    const check = (kit.core.validate as (w: unknown) => { blockers: string[] })(want);
    if (check.blockers.length) {
      setProblem(new Error(`Not ready to build:\n${check.blockers.join('\n')}`));
      return;
    }

    const made: Built[] = [];
    for (const c of contracts) {
      const ctx = (kit.core.normalize as (c: Contract) => Contract)(c);
      const contractId = String(ctx.contractId ?? 'unknown');
      try {
        if (want.res) {
          const pkg = await (kit.docxkit.openDocx as (t: ArrayBuffer) => Promise<{ blob(): Promise<Blob> }>)(
            kit.templates.tplBacres,
          );
          const info = (kit.builders.buildResolution as (p: unknown, c: unknown) => { resNo: string })(pkg, ctx);
          made.push({
            path: `bac res/BAC RES ${info.resNo}.docx`,
            name: `BAC RES ${info.resNo}.docx`,
            blob: await pkg.blob(),
            contractId,
            kind: 'BAC Resolution',
          });
        }

        if (want.notice) {
          const winner = (kit.rules.pickWinner as (b: unknown) => unknown)(ctx.bidders);
          const addr = (kit.core.findAddressee as (w: unknown) => { short?: string } | null)(winner);
          if (!addr) {
            say(`${contractId}: no addressee on file for the winner — notice skipped`);
          } else {
            const pkg = await (kit.docxkit.openDocx as (t: ArrayBuffer) => Promise<{ blob(): Promise<Blob> }>)(
              kit.templates.tplNotice,
            );
            (kit.builders.buildNotice as (p: unknown, c: unknown, a: unknown) => void)(pkg, ctx, addr);
            const who = addr.short ?? (kit.core.shortOf as (a: unknown) => string)(addr);
            made.push({
              path: `notice of post qualification/${contractId}- ${who}.docx`,
              name: `${contractId} — ${who}.docx`,
              blob: await pkg.blob(),
              contractId,
              kind: 'Notice of Post-Qualification',
            });
          }
        }
      } catch (e) {
        say(`${contractId}: ${(e as Error).message}`);
      }
    }

    if (!made.length) {
      setProblem(new Error('Nothing was generated. The log below says why.'));
      return;
    }
    setBuilt(made);
    say(`${made.length} document(s) built`);
  };

  const downloadAll = async () => {
    if (!kit) return;
    const zip = new kit.JSZip();
    for (const b of built) zip.file(b.path, b.blob);
    if (want.sheet) zip.file('DATA ENTRY USED.csv', (kit.core.dataEntryCsv as () => string)());
    const stamp = (kit.core.stamp as () => string)();
    save(await zip.generateAsync({ type: 'blob' }), `new files ${stamp}.zip`);
  };

  const save = (blob: Blob, name: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
  };

  /* ---------------------------------------------------------------- render --- */

  if (loadError) {
    return (
      <div className="view">
        <header className="vhead">
          <h1>Document Builder</h1>
        </header>
        <Problem error={loadError} />
      </div>
    );
  }

  if (!kit) {
    return (
      <div className="view">
        <header className="vhead">
          <h1>Document Builder</h1>
        </header>
        <Explain>Fetching the templates and libraries. This happens once per visit.</Explain>
        <Loading />
      </div>
    );
  }

  return (
    <div className="view">
      <header className="vhead">
        <h1>Document Builder</h1>
        <span className="q">abstract in, paperwork out</span>
      </header>

      {/* Three jobs used on different occasions, so they do not share one screen. */}
      <div className="chipgroup" role="group" aria-label="What to do">
        {(
          [
            ['build', 'Build documents'],
            ['letters', 'Witness letters'],
            ['setup', 'Setup'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className="chip" aria-pressed={pane === k} onClick={() => setPane(k)}>
            {label}
          </button>
        ))}
      </div>

      {pane === 'letters' && <Letters kit={kit} contracts={contracts} holidays={holidays} say={say} />}
      {pane === 'setup' && <Setup kit={kit} holidays={holidays} setHolidays={setHolidays} />}

      {pane === 'build' && (
        <>
      <Explain>
        Give it an abstract of bids and it writes the BAC resolution and the notice of post-qualification from the
        office templates. You can download what it builds, file it against a contract in the register, or both.
      </Explain>

      <Problem error={problem} onDismiss={() => setProblem(null)} />

      <h2 className="h2">1. Where the contracts come from</h2>
      <div className="actions">
        <label className="btn btn-secondary btn-sm filebtn">
          {reading ? 'Reading…' : 'Read an abstract (PDF)'}
          <input
            type="file"
            accept="application/pdf"
            disabled={reading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void readAbstract(f);
            }}
          />
        </label>
      </div>

      <div className="field" style={{ maxWidth: '100%', marginTop: 14 }}>
        <label htmlFor="paste-rows">Or paste the rows</label>
        {/*
          The field order is the parser's, not a guess. The placeholder used to
          show the contract name second, which reads naturally and is wrong:
          field two is the ABC, and a name there parses as an amount of nothing.
          Following the old placeholder produced "Unnamed, 0 bidders" and said
          nothing about why.
        */}
        <span className="q hint">
          One contract per line. Use this when the abstract is a scan and recognition is unavailable.
          <br />
          Separate the fields with a <b>tab</b>, two or more spaces, or a <b>|</b> — never a bare comma, because
          amounts and dates contain them. In order:
          <br />
          <span className="mono">
            contract ID · ABC · advertised · opened · as-calculated · notice · then contractor and bid amount, in pairs
          </span>
          <br />
          Dates and bidders are optional — an ID on its own is read. The contract name is not taken from the paste;
          it comes from the abstract or is filled in later.
        </span>
        <textarea
          id="paste-rows"
          rows={4}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder={
            '26HH0041	12,345,678.90	2026-04-01	2026-04-22	2026-04-23	2026-05-04	ALEGRIA CONSTRUCTION	11,900,000.00'
          }
        />
      </div>
      <div className="actions">
        <Action label="Use pasted rows" onClick={applyPaste} disabled={!paste.trim()} why="Paste something first" />
      </div>

      <h2 className="h2">2. Contracts read ({contracts.length})</h2>
      {contracts.length === 0 ? (
        <p className="q">Nothing yet. Read an abstract or paste rows above.</p>
      ) : (
        <ul className="remlist">
          {contracts.map((c, i) => (
            <li key={String(c.contractId ?? i)} className="rem">
              <span className="level level-in-progress">{String(c.contractId ?? '—')}</span>
              <div className="rem-main">
                <div className="rem-title">
                  {/*
                    `contractName`, not `name`. The contract's name has always
                    been `contractName` — it is what goes into the resolution
                    ("Contract Name : …") and the data-entry sheet. `name` is a
                    *bidder's* property, so this read was always undefined and
                    every row said "Unnamed", including rows read from an
                    abstract that did carry the name.
                  */}
                  <b>{String(c.contractName || 'Not named yet')}</b>
                </div>
                <div className="rem-meta q">
                  {(c.bidders as unknown[] | undefined)?.length ?? 0} bidder(s)
                  {!c.contractName && ' · pasted rows carry no name; the abstract or the register supplies it'}
                </div>
              </div>
              <div className="rem-act">
                <Action label="Remove" onClick={() => setContracts(contracts.filter((_, j) => j !== i))} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 className="h2">3. What to build</h2>
      <div className="actions">
        {(
          [
            ['res', 'BAC Resolution'],
            ['notice', 'Notice of Post-Qualification'],
            ['sheet', 'Data-entry sheet'],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="req">
            <input type="checkbox" checked={want[k]} onChange={(e) => setWant({ ...want, [k]: e.target.checked })} />
            {label}
          </label>
        ))}
      </div>
      <div className="actions" style={{ marginTop: 12 }}>
        <Action
          label="Build them"
          kind="primary"
          onClick={build}
          disabled={contracts.length === 0}
          why="Read an abstract or paste rows first"
        />
      </div>

      {built.length > 0 && (
        <>
          <h2 className="h2">4. What it built ({built.length})</h2>
          <div className="actions" style={{ marginBottom: 12 }}>
            <Action label="Download all as .zip" kind="primary" onClick={downloadAll} />
          </div>
          <ul className="remlist">
            {built.map((b, i) => (
              <BuiltRow
                key={b.path}
                item={b}
                onSave={() => save(b.blob, b.name)}
                onFiled={(where) => setBuilt(built.map((x, j) => (i === j ? { ...x, filedAs: where } : x)))}
              />
            ))}
          </ul>
        </>
      )}

        </>
      )}

      <h2 className="h2">Log</h2>
      <pre className="buildlog">{log.join('\n') || 'Nothing yet.'}</pre>
    </div>
  );
}

/* --------------------------------------------------------------- filing --- */

function BuiltRow({
  item,
  onSave,
  onFiled,
}: {
  item: Built;
  onSave: () => void;
  onFiled: (where: string) => void;
}) {
  const [filing, setFiling] = useState(false);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectId, setProjectId] = useState('');
  const [slots, setSlots] = useState<ProjectSlot[]>([]);
  const [slotCode, setSlotCode] = useState('');
  const [problem, setProblem] = useState<unknown>(null);
  const [step, setStep] = useState<string | null>(null);

  const open = async () => {
    setFiling(true);
    setProblem(null);
    try {
      const { rows } = await registerApi.list();
      setProjects(rows.map((r) => r.project));
    } catch (e) {
      setProblem(e);
    }
  };

  const pickProject = async (id: string) => {
    setProjectId(id);
    setSlotCode('');
    setSlots([]);
    if (!id) return;
    try {
      const detail = await registerApi.detail(id);
      setSlots(detail.slots);
    } catch (e) {
      setProblem(e);
    }
  };

  const file = async () => {
    setProblem(null);
    try {
      const asFile = new File([item.blob], item.name, {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const upload = await uploadToSlot(projectId, slotCode, asFile, (s) => setStep(s));
      if (upload.scanState !== 'Clean') {
        throw new Error(`The scan did not pass (${upload.scanState}), so it was not filed.`);
      }
      await writeApi.createDocument({
        projectId,
        slotCode,
        title: item.name.replace(/\.[^.]+$/, ''),
        uploadId: upload.id,
      });
      const contract = projects?.find((p) => p.id === projectId)?.contractId ?? projectId;
      onFiled(`${contract} · ${slotCode}`);
      setFiling(false);
    } catch (e) {
      setProblem(e);
    } finally {
      setStep(null);
    }
  };

  return (
    <li className="rem">
      <span className="level level-in-progress">{item.kind === 'BAC Resolution' ? 'Resolution' : 'Notice'}</span>
      <div className="rem-main">
        <div className="rem-title">
          <b>{item.name}</b>
          <span className="q"> · {item.contractId}</span>
        </div>
        {item.filedAs && <div className="rem-meta q">Filed against {item.filedAs}</div>}

        {filing && (
          <Panel
            title="File this against a contract"
            explain="It is uploaded into the slot you choose, scanned, and recorded as a Draft. You then finalize and sign it in the Register like any other document."
            onCancel={() => setFiling(false)}
          >
            <Problem error={problem} onDismiss={() => setProblem(null)} />

            <div className="field">
              <label htmlFor={`proj-${item.path}`}>Contract</label>
              <select id={`proj-${item.path}`} value={projectId} onChange={(e) => void pickProject(e.target.value)}>
                <option value="">Choose…</option>
                {(projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.contractId} — {p.name}
                  </option>
                ))}
              </select>
            </div>

            {projectId && (
              <div className="field">
                <label htmlFor={`slot-${item.path}`}>Which document is it?</label>
                <span className="q hint">
                  {slots.length === 0
                    ? 'This contract has no document set yet — choose one in the Register first.'
                    : 'The slot it belongs in.'}
                </span>
                <select id={`slot-${item.path}`} value={slotCode} onChange={(e) => setSlotCode(e.target.value)}>
                  <option value="">Choose…</option>
                  {slots.map((s) => (
                    <option key={s.slotCode} value={s.slotCode}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {step && <p className="q busystep">Filing… ({step})</p>}

            <Action
              label="File it"
              kind="primary"
              disabled={!projectId || !slotCode || step !== null}
              why="Choose a contract and a slot first"
              onClick={file}
            />
          </Panel>
        )}
      </div>

      <div className="rem-act">
        <div className="actions">
          <Action label="Download" onClick={onSave} />
          {!item.filedAs && !filing && <Action label="File it…" onClick={open} />}
        </div>
      </div>
    </li>
  );
}
