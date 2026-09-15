/**
 * The register — contracts, and the documents each one owes.
 *
 * This is where the work is done, so it is the screen that has to teach the
 * rules. A contract with no document set says so and offers to fix it; a slot
 * with nothing in it offers to take a file; a document shows where it is in the
 * lifecycle and what can happen next. Nothing here assumes the reader already
 * knows what "instantiate a slot template" means.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  registerApi,
  templatesApi,
  writeApi,
  uploadToSlot,
  lifecycleApi,
  ApiError,
  type Doc,
  type DocumentState,
  type LifecycleDescription,
  type Project,
  type ProjectSlot,
  type Readiness,
  type SlotOutcome,
  type Upload,
} from '../api';
import { Action, Empty, Explain, Failed, Field, Loading, Panel, Problem, days, when } from './bits';
import { NextSteps, Track } from './Lifecycle';

const OUTCOME_LABEL: Record<SlotOutcome, string> = {
  signed: 'Signed',
  'awaiting-approval': 'Awaiting signature',
  'in-progress': 'In progress',
  waived: 'Waived',
  empty: 'Not started',
};

function Pct({ r }: { r: Readiness | null }) {
  if (!r || r.percent === null) return <span className="q">no set</span>;
  return (
    <>
      {r.percent}
      <small>%</small>
    </>
  );
}

/* ------------------------------------------------------------------ list --- */

function List() {
  const [rows, setRows] = useState<{ project: Project; readiness: Readiness | null }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [contractId, setContractId] = useState('');
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<unknown>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows((await registerApi.list()).rows);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setProblem(null);
    try {
      const { project } = await writeApi.createProject({ contractId: contractId.trim(), name: name.trim() });
      setAdding(false);
      setContractId('');
      setName('');
      window.location.hash = `#/register/${project.id}`;
    } catch (e) {
      setProblem(e);
    }
  };

  if (error) return <Failed message={error} onRetry={() => void load()} />;
  if (rows === null) return <Loading />;

  return (
    <div className="view">
      <header className="vhead">
        <h1>Register</h1>
        <span className="q">
          {rows.length} contract{rows.length === 1 ? '' : 's'}
        </span>
      </header>
      <Explain>
        Every contract and how much of its required paperwork is finished. A contract counts as finished only when
        each required document has been signed.
      </Explain>

      {adding ? (
        <Panel
          title="New contract"
          explain="The contract number has to be unique — the register will refuse a second one with the same number."
          onCancel={() => {
            setAdding(false);
            setProblem(null);
          }}
        >
          <Problem error={problem} onDismiss={() => setProblem(null)} />
          <Field
            id="new-contract-id"
            label="Contract number"
            hint="As it appears on the contract, e.g. 26HH0041."
            value={contractId}
            onChange={setContractId}
            placeholder="26HH0041"
            autoFocus
          />
          <Field
            id="new-contract-name"
            label="Project name"
            hint="What the work is, in your own words."
            value={name}
            onChange={setName}
            placeholder="Rehabilitation of Barangay Road, Section 1"
          />
          <Action
            label="Create contract"
            kind="primary"
            disabled={!contractId.trim() || !name.trim()}
            why="Fill in both fields first"
            onClick={create}
          />
        </Panel>
      ) : (
        <div className="actions" style={{ marginBottom: 18 }}>
          <Action label="New contract" kind="primary" onClick={() => setAdding(true)} />
        </div>
      )}

      {rows.length === 0 ? (
        <Empty
          title="No contracts yet."
          body="Add the first one above. You will then choose which documents it has to produce."
        />
      ) : (
        <ul className="plist">
          {rows.map(({ project, readiness }) => (
            <li key={project.id} className="prow">
              <div className="prow-head">
                <a className="prow-title" href={`#/register/${project.id}`}>
                  <b>{project.contractId}</b> <span className="q">{project.name}</span>
                </a>
                <span className="prow-pct">
                  <Pct r={readiness} />
                </span>
              </div>
              <div className="meter">
                <i style={{ width: `${readiness?.percent ?? 0}%` }} />
              </div>
              {readiness && (
                <div className="prow-meta q">
                  {readiness.requiredTotal === 0 ? (
                    <>No document set chosen yet — open it to pick one</>
                  ) : (
                    <>
                      {readiness.closedOut} of {readiness.requiredTotal} closed out
                      {readiness.awaitingApproval > 0 && (
                        <span className="debt"> · {readiness.awaitingApproval} awaiting signature</span>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- detail --- */

interface Detail {
  project: Project;
  readiness: { readiness: Readiness; slots: { slotCode: string; outcome: SlotOutcome }[] } | null;
  slots: ProjectSlot[];
  documents: Doc[];
}

function SlotRow({
  slot,
  outcome,
  documents,
  projectId,
  lifecycle,
  onChanged,
}: {
  slot: ProjectSlot;
  outcome: SlotOutcome | null;
  documents: Doc[];
  projectId: string;
  lifecycle: LifecycleDescription | null;
  onChanged: () => Promise<void>;
}) {
  const [busyStep, setBusyStep] = useState<string | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const [waiving, setWaiving] = useState(false);
  const [reason, setReason] = useState('');
  const [lastUpload, setLastUpload] = useState<Upload | null>(null);

  const live = documents.filter((d) => d.slotCode === slot.slotCode && d.state !== 'Superseded' && d.state !== 'Void');

  const takeFile = async (file: File) => {
    setProblem(null);
    setLastUpload(null);
    try {
      const upload = await uploadToSlot(projectId, slot.slotCode, file, (s) => setBusyStep(s));
      setLastUpload(upload);

      if (upload.scanState === 'Clean') {
        await writeApi.createDocument({
          projectId,
          slotCode: slot.slotCode,
          title: file.name.replace(/\.[^.]+$/, ''),
          uploadId: upload.id,
        });
      }
      await onChanged();
    } catch (e) {
      setProblem(e);
    } finally {
      setBusyStep(null);
    }
  };

  const waive = async () => {
    setProblem(null);
    try {
      await writeApi.waive(projectId, slot.slotCode, reason);
      setWaiving(false);
      setReason('');
      await onChanged();
    } catch (e) {
      setProblem(e);
    }
  };

  const STEP_TEXT: Record<string, string> = {
    hashing: 'Reading the file…',
    uploading: 'Storing it…',
    registering: 'Recording it…',
    scanning: 'Scanning for viruses…',
  };

  return (
    <li className="slot">
      <div className="slot-head">
        <span className={`level level-${outcome ?? 'empty'}`}>{outcome ? OUTCOME_LABEL[outcome] : slot.state}</span>
        <div className="slot-main">
          <div className="rem-title">
            <b>{slot.name}</b>
            <span className="q"> · {slot.slotCode}</span>
            {!slot.required && <span className="q"> · optional</span>}
          </div>
          {slot.state === 'Waived' && slot.waivedReason && (
            <div className="rem-reason q">Waived — {slot.waivedReason}</div>
          )}
        </div>
      </div>

      <Problem error={problem} onDismiss={() => setProblem(null)} />

      {lastUpload && lastUpload.scanState !== 'Clean' && (
        <div className="problem" role="alert">
          <b>The scan did not pass, so this file was not accepted.</b>
          <div>
            {lastUpload.scanState === 'Infected'
              ? `The scanner reported: ${lastUpload.scanDetail ?? 'a detection'}.`
              : `The scanner could not give a verdict: ${lastUpload.scanDetail ?? 'unknown error'}. A scan that fails is never treated as a pass.`}
          </div>
        </div>
      )}

      {busyStep && <p className="q busystep">{STEP_TEXT[busyStep] ?? 'Working…'}</p>}

      {waiving ? (
        <Panel
          title={`Waive ${slot.name}`}
          explain="Waiving says this contract does not need this document. The reason is kept permanently."
          onCancel={() => {
            setWaiving(false);
            setReason('');
          }}
        >
          <Field
            id={`waive-${slot.slotCode}`}
            label="Why is it not needed?"
            value={reason}
            onChange={setReason}
            placeholder="e.g. No asphalt works in this contract"
            autoFocus
          />
          <Action
            label="Waive it"
            kind="primary"
            disabled={!reason.trim()}
            why="Type a reason first"
            onClick={waive}
          />
        </Panel>
      ) : (
        !busyStep && (
          <div className="actions slot-actions">
            <label className="btn btn-secondary btn-sm filebtn">
              {live.length ? 'Upload a new version' : 'Upload a file'}
              <input
                type="file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void takeFile(f);
                }}
              />
            </label>
            {slot.state !== 'Waived' && live.length === 0 && (
              <Action label="Not needed" onClick={() => setWaiving(true)} />
            )}
          </div>
        )
      )}

      {live.map((d) => (
        <DocumentCard key={d.id} doc={d} lifecycle={lifecycle} onChanged={onChanged} />
      ))}
    </li>
  );
}

function DocumentCard({
  doc,
  lifecycle,
  onChanged,
}: {
  doc: Doc;
  lifecycle: LifecycleDescription | null;
  onChanged: () => Promise<void>;
}) {
  return (
    <div className="doccard">
      <div className="doccard-head">
        <b>{doc.title}</b>
        <span className="q">
          {doc.state} for {days(doc.stateSince)}
        </span>
      </div>

      {lifecycle && <Track state={doc.state} mainLine={lifecycle.mainLine} />}

      <div className="q doccard-meta">
        since {when(doc.stateSince)}
        {doc.contentHash && <> · frozen as {doc.contentHash.slice(0, 12)}…</>}
      </div>

      {lifecycle && (
        <NextSteps
          state={doc.state}
          transitions={lifecycle.transitions}
          onMove={async (to: DocumentState, reason?: string) => {
            await writeApi.transition(doc.id, to, reason);
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

function DetailView({ id }: { id: string }) {
  const [data, setData] = useState<Detail | null>(null);
  const [lifecycle, setLifecycle] = useState<LifecycleDescription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<unknown>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [detail, lc] = await Promise.all([registerApi.detail(id), lifecycleApi.describe()]);
      setData(detail as Detail);
      setLifecycle(lc);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    }
  }, [id]);

  const refresh = useCallback(async () => {
    setData((await registerApi.detail(id)) as Detail);
  }, [id]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  const assign = async () => {
    setProblem(null);
    try {
      await templatesApi.active(code.trim()); // a clearer 404 than the assign call gives
      await writeApi.assignSlots(id, code.trim());
      setChoosing(false);
      setCode('');
      await refresh();
    } catch (e) {
      setProblem(e);
    }
  };

  if (error) return <Failed message={error} onRetry={() => void load()} />;
  if (data === null) return <Loading />;

  const outcomeOf = (slotCode: string): SlotOutcome | null =>
    data.readiness?.slots.find((s) => s.slotCode === slotCode)?.outcome ?? null;

  return (
    <div className="view">
      <a className="back q" href="#/register">
        ← All contracts
      </a>

      <header className="vhead">
        <h1>{data.project.contractId}</h1>
        <span className="q">{data.project.name}</span>
      </header>

      {data.readiness && data.readiness.readiness.requiredTotal > 0 && (
        <div className="cards">
          <div>
            <div className="lbl q">Ready</div>
            <div className="figure">
              <Pct r={data.readiness.readiness} />
            </div>
          </div>
          <div>
            <div className="lbl q">Signed off</div>
            <div className="figure">
              {data.readiness.readiness.closedOut}
              <small> / {data.readiness.readiness.requiredTotal}</small>
            </div>
          </div>
          <div>
            <div className="lbl q">Awaiting signature</div>
            <div className={`figure ${data.readiness.readiness.awaitingApproval ? 'warn' : ''}`}>
              {data.readiness.readiness.awaitingApproval}
            </div>
          </div>
          <div>
            <div className="lbl q">Documents</div>
            <div className="figure">{data.documents.length}</div>
          </div>
        </div>
      )}

      <h2 className="h2">Documents this contract must produce</h2>

      {data.slots.length === 0 ? (
        choosing ? (
          <Panel
            title="Choose a document set"
            explain="The set is copied onto this contract as it stands today. Changing the set later will not change this contract — that is deliberate, so a completion figure never changes meaning after the fact."
            onCancel={() => {
              setChoosing(false);
              setProblem(null);
            }}
          >
            <Problem error={problem} onDismiss={() => setProblem(null)} />
            <Field
              id="template-code"
              label="Set name"
              hint="The short code of a published set — see the Document sets tab."
              value={code}
              onChange={setCode}
              placeholder="demo-set"
              autoFocus
            />
            <Action
              label="Use this set"
              kind="primary"
              disabled={!code.trim()}
              why="Type a set name first"
              onClick={assign}
            />
          </Panel>
        ) : (
          <Empty
            title="No document set chosen yet."
            body="Until this contract has a set, nothing is required of it and its readiness cannot be measured."
          >
            <Action label="Choose a document set" kind="primary" onClick={() => setChoosing(true)} />
          </Empty>
        )
      ) : (
        <ul className="slotlist">
          {data.slots.map((s) => (
            <SlotRow
              key={s.slotCode}
              slot={s}
              outcome={outcomeOf(s.slotCode)}
              documents={data.documents}
              projectId={id}
              lifecycle={lifecycle}
              onChanged={refresh}
            />
          ))}
        </ul>
      )}

      {data.documents.some((d) => d.state === 'Superseded' || d.state === 'Void') && (
        <>
          <h2 className="h2">Older versions</h2>
          <Explain>Kept because the record of what was approved must not disappear when it is replaced.</Explain>
          <ul className="remlist">
            {data.documents
              .filter((d) => d.state === 'Superseded' || d.state === 'Void')
              .map((d) => (
                <li key={d.id} className="rem rem-read">
                  <span className="level level-state">{d.state}</span>
                  <div className="rem-main">
                    <div className="rem-title">
                      <b>{d.title}</b>
                      <span className="q"> · {d.slotCode}</span>
                    </div>
                    <div className="rem-meta q">since {when(d.stateSince)}</div>
                  </div>
                </li>
              ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default function Register({ projectId }: { projectId: string | null }) {
  return projectId ? <DetailView id={projectId} /> : <List />;
}
