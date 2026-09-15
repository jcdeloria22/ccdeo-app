/**
 * The Builder's reference data and its witness letters.
 *
 * Both were tabs in the standalone Builder. They are separated from the main
 * abstract-to-resolution flow here because they are used on different occasions:
 * the letters go out once per invitation-to-bid date and are not tied to any one
 * contract, and the reference data is set up once and then left alone.
 *
 * Signatories and holidays live on the server, not in this browser. They decide
 * what appears on an issued document and which working days a notice date lands
 * on, so losing them to a cleared cache — after the paper has gone out — is not
 * an acceptable failure.
 */
import { useCallback, useEffect, useState } from 'react';
import { settingsApi, type Signatories } from '../api';
import type { Builder as Kit } from '../builder/load';
import { Action, Explain, Field, Problem } from './bits';

const TEMPLATE_NAMES: Record<string, string> = {
  tplBacres: 'BAC Resolution',
  tplNotice: 'Notice of Post-Qualification',
  tplCebuContractors: 'Cebu Contractors letter',
  tplPICE: 'PICE letter',
  tplAuditor: 'Resident Auditor letter',
  tplPACC: 'PACC letter',
};

const BLANK_SIG: Signatories = { chair: '', vice: '', de: '', so: '' };

/* ---------------------------------------------------------------- letters --- */

export function Letters({
  kit,
  contracts,
  holidays,
  say,
}: {
  kit: Kit;
  contracts: unknown[];
  holidays: string[];
  say: (line: string) => void;
}) {
  const [letterDate, setLetterDate] = useState('');
  const [prebidDate, setPrebidDate] = useState('');
  const [openingDate, setOpeningDate] = useState('');
  const [folder, setFolder] = useState('');
  const [problem, setProblem] = useState<unknown>(null);

  const hasDates = letterDate !== '' && openingDate !== '';
  const ready = hasDates && contracts.length > 0;

  const build = async () => {
    setProblem(null);

    /*
     * The schedule the letters print, derived rather than typed.
     *
     * `buildProse` and `buildPacc` read `cfg.sched` — the bid-evaluation and
     * post-qualification spans, and the PACC table's row. `rules.deriveSchedule`
     * produces exactly that from the opening date, counting working days around
     * the holidays on file. The standalone Builder never called it, so every
     * letter it tried to build failed on an undefined `sched`; the rule was
     * always there, it was simply never wired up.
     *
     * Not computed here by hand: "bid evaluation is two working days, post-
     * qualification the next three" is a procurement rule, and it lives in the
     * proven library, not in a screen.
     */
    const sched = (kit.rules.deriveSchedule as (o: string, opts: unknown) => unknown)(openingDate, {
      extraHolidays: holidays,
    });

    const cfg = {
      letterDate,
      prebidDate,
      openingDate,
      folder,
      contracts,
      sched,
      prebid: prebidDate
        ? (kit.rules.letterDate as (d: string) => string)(prebidDate)
        : (kit.rules.letterDate as (d: string) => string)(openingDate),
    };
    const zip = new kit.JSZip();
    let made = 0;

    for (const [key, filename] of [
      ['tplCebuContractors', 'Cebu Contractors.docx'],
      ['tplPICE', 'PICE.docx'],
      ['tplAuditor', 'Resident Auditor.docx'],
      ['tplPACC', 'PACC.docx'],
    ] as const) {
      if (!kit.templates[key]) {
        say(`missing template ${key}`);
        continue;
      }
      try {
        const pkg = await (kit.docxkit.openDocx as (t: ArrayBuffer) => Promise<{ blob(): Promise<Blob> }>)(
          kit.templates[key],
        );
        if (filename === 'PACC.docx') (kit.letters.buildPacc as (p: unknown, c: unknown) => void)(pkg, cfg);
        else (kit.letters.buildProse as (p: unknown, c: unknown) => void)(pkg, cfg);
        zip.file(`${folder || 'invitation'}/${filename}`, await pkg.blob());
        made++;
      } catch (e) {
        say(`${filename}: ${(e as Error).message}`);
      }
    }

    if (!made) {
      setProblem(new Error('No letters were built. The log says why.'));
      return;
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${folder || 'invitation'}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
    say(`${made} letter(s) written`);
  };

  return (
    <>
      <h2 className="h2">Invitation-to-bid witness letters</h2>
      <Explain>
        Four letters go out per invitation-to-bid date, covering every contract opened that day. They belong to the
        date, not to any one contract, so they are downloaded rather than filed against a contract.
      </Explain>

      <Problem error={problem} onDismiss={() => setProblem(null)} />

      <div className="daterow">
        <Field id="letter-date" label="Letter date" type="date" value={letterDate} onChange={setLetterDate} />
        <Field id="prebid-date" label="Pre-bid date" type="date" value={prebidDate} onChange={setPrebidDate} />
        <Field id="opening-date" label="Opening date" type="date" value={openingDate} onChange={setOpeningDate} />
      </div>
      <Field
        id="letter-folder"
        label="Folder name"
        hint="What the zip and its folder are called. Defaults to “invitation”."
        value={folder}
        onChange={setFolder}
        placeholder="invitation"
      />

      <div className="actions">
        <Action
          label="Build the four letters"
          kind="primary"
          onClick={build}
          disabled={!ready}
          why={
            contracts.length === 0
              ? 'Load at least one contract first'
              : 'A letter date and an opening date are needed'
          }
        />
      </div>
      {!hasDates && (
        <p className="q nextnote">A letter date and an opening date are needed before these can be built.</p>
      )}
      {contracts.length === 0 && (
        <p className="q nextnote">
          No contracts are loaded. Three of the four letters list the contracts being opened and cannot be written
          without at least one — read an abstract or paste rows on the Build documents tab first.
        </p>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ setup --- */

export function Setup({
  kit,
  holidays,
  setHolidays,
}: {
  kit: Kit;
  holidays: string[];
  setHolidays: (h: string[]) => void;
}) {
  const [sig, setSig] = useState<Signatories>(BLANK_SIG);
  const [sigSavedAt, setSigSavedAt] = useState<string | null>(null);
  const [newHoliday, setNewHoliday] = useState('');
  const [problem, setProblem] = useState<unknown>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([
        settingsApi.get<Signatories>('builder.signatories'),
        settingsApi.get<string[]>('builder.holidays'),
      ]);
      if (s.setting) {
        setSig({ ...BLANK_SIG, ...s.setting.value });
        setSigSavedAt(s.setting.updatedAt);
      }
      if (h.setting) setHolidays(h.setting.value ?? []);
    } catch (e) {
      setProblem(e);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveSig = async () => {
    setProblem(null);
    try {
      const { setting } = await settingsApi.put('builder.signatories', sig);
      setSigSavedAt(setting.updatedAt);
    } catch (e) {
      setProblem(e);
    }
  };

  const saveHolidays = async (next: string[]) => {
    setProblem(null);
    try {
      await settingsApi.put('builder.holidays', next);
      setHolidays(next);
    } catch (e) {
      setProblem(e);
    }
  };

  const contractorCount = Object.keys(kit.contractors).length;

  return (
    <>
      <h2 className="h2">Templates</h2>
      <Explain>Bundled with the app. Nothing to load, and nothing to go missing.</Explain>
      <ul className="remlist">
        {Object.entries(TEMPLATE_NAMES).map(([key, name]) => (
          <li key={key} className="rem">
            <span className={`level level-${kit.templates[key] ? 'signed' : 'empty'}`}>
              {kit.templates[key] ? 'Loaded' : 'Missing'}
            </span>
            <div className="rem-main">
              <div className="rem-title">
                <b>{name}</b>
                <span className="q mono"> · {key}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <h2 className="h2">Signatories</h2>
      <Explain>
        Which signatory prints is decided by each document’s <b>notice date</b>, never by today’s date — so a document
        issued for an earlier date still carries whoever was in post then. Kept on the server, because these names go
        out on paper.
      </Explain>

      <Problem error={problem} onDismiss={() => setProblem(null)} />

      {loaded && (
        <>
          <div className="daterow">
            <Field
              id="sig-chair"
              label="BAC Chairperson"
              value={sig.chair}
              onChange={(v) => setSig({ ...sig, chair: v })}
            />
            <Field
              id="sig-vice"
              label="BAC Vice Chairperson"
              value={sig.vice}
              onChange={(v) => setSig({ ...sig, vice: v })}
            />
            <Field id="sig-de" label="District Engineer" value={sig.de} onChange={(v) => setSig({ ...sig, de: v })} />
            <Field id="sig-so" label="S.O. line" value={sig.so} onChange={(v) => setSig({ ...sig, so: v })} />
          </div>
          <div className="actions">
            <Action label="Save signatories" kind="primary" onClick={saveSig} />
          </div>
          {sigSavedAt && (
            <p className="q nextnote">Last changed {new Date(sigSavedAt).toLocaleString()}. The change is audited.</p>
          )}
        </>
      )}

      <h2 className="h2">Extra holidays</h2>
      <Explain>
        Regular Philippine holidays are built in. Special non-working days are proclaimed at short notice and change
        the working-day count, which moves every date calculated from it — so add them here as they are announced.
      </Explain>

      <div className="actions" style={{ alignItems: 'flex-end' }}>
        <div style={{ maxWidth: 220 }}>
          <Field id="new-holiday" label="Date" type="date" value={newHoliday} onChange={setNewHoliday} />
        </div>
        <Action
          label="Add"
          onClick={() => {
            if (!newHoliday || holidays.includes(newHoliday)) return;
            void saveHolidays([...holidays, newHoliday].sort());
            setNewHoliday('');
          }}
          disabled={!newHoliday || holidays.includes(newHoliday)}
          why={holidays.includes(newHoliday) ? 'That date is already listed' : 'Pick a date first'}
        />
      </div>

      {holidays.length === 0 ? (
        <p className="q nextnote">None added.</p>
      ) : (
        <ul className="holidays">
          {holidays.map((h) => (
            <li key={h}>
              <span>{h}</span>
              <button
                className="btn btn-secondary btn-sm"
                aria-label={`Remove ${h}`}
                onClick={() => void saveHolidays(holidays.filter((x) => x !== h))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <h2 className="h2">Contractors</h2>
      <Explain>
        {contractorCount} on file. Used to match a winning bid to the right letter addressee — a winner with no match
        is reported and its notice is skipped rather than addressed to a guess.
      </Explain>
      <div className="actions">
        <Action
          label="Export as JSON"
          onClick={() => {
            const blob = new Blob([JSON.stringify(kit.contractors, null, 1)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'contractors.json';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
          }}
        />
      </div>
    </>
  );
}
