/**
 * Document sets — the list of documents a contract has to produce.
 *
 * Called "document sets" here rather than "slot templates", which is what they
 * are in the database. Nobody arriving at this screen is looking for a template.
 *
 * The versioning is the part worth explaining, because it is the part that
 * surprises people: a set is copied onto a contract when the contract is created,
 * and editing the set afterwards does not reach back. That is not a limitation,
 * it is the reason a readiness figure from last month still means what it said.
 */
import { useCallback, useEffect, useState } from 'react';
import { templatesApi, type SlotTemplate, type SlotTemplateItem } from '../api';
import { Action, Empty, Explain, Field, Panel, Problem } from './bits';

interface Draft {
  slotCode: string;
  name: string;
  required: boolean;
}

const BLANK: Draft = { slotCode: '', name: '', required: true };

export default function Sets() {
  const [code, setCode] = useState('');
  const [looked, setLooked] = useState<{ template: SlotTemplate | null; items: SlotTemplateItem[] } | null>(null);
  const [problem, setProblem] = useState<unknown>(null);

  const [building, setBuilding] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [rows, setRows] = useState<Draft[]>([{ ...BLANK }]);

  const look = useCallback(async (c: string) => {
    setProblem(null);
    try {
      setLooked(await templatesApi.active(c.trim()));
    } catch (e) {
      setProblem(e);
      setLooked(null);
    }
  }, []);

  useEffect(() => {
    void look('demo-set');
    setCode('demo-set');
  }, [look]);

  const usable = rows.filter((r) => r.slotCode.trim() && r.name.trim());

  const create = async () => {
    setProblem(null);
    try {
      const { template } = await templatesApi.create({
        code: newCode.trim(),
        name: newName.trim(),
        items: usable.map((r) => ({ slotCode: r.slotCode.trim(), name: r.name.trim(), required: r.required })),
      });
      await templatesApi.publish(template.id);
      setBuilding(false);
      setNewCode('');
      setNewName('');
      setRows([{ ...BLANK }]);
      setCode(template.code);
      await look(template.code);
    } catch (e) {
      setProblem(e);
    }
  };

  return (
    <div className="view">
      <header className="vhead">
        <h1>Document sets</h1>
        <span className="q">what a contract has to produce</span>
      </header>
      <Explain>
        A set lists the documents a contract owes. You attach a set to a contract once; after that, changing the set
        does not change contracts already using it — so a completion figure never quietly starts meaning something
        different.
      </Explain>

      <Problem error={problem} onDismiss={() => setProblem(null)} />

      <h2 className="h2">Look up a set</h2>
      <div className="actions" style={{ alignItems: 'flex-end', gap: 12 }}>
        <div style={{ flex: '1 1 220px', maxWidth: 320 }}>
          <Field
            id="lookup-code"
            label="Set name"
            hint="The short code, e.g. demo-set"
            value={code}
            onChange={setCode}
            placeholder="demo-set"
          />
        </div>
        <Action label="Show it" onClick={() => look(code)} disabled={!code.trim()} why="Type a set name first" />
      </div>

      {looked &&
        (looked.template === null ? (
          <Empty title={`No published set called "${code}".`} body="Create one below, or check the spelling." />
        ) : (
          <div className="card setcard">
            <div className="prow-head">
              <div>
                <b>{looked.template.name}</b>{' '}
                <span className="q">
                  · {looked.template.code} · version {looked.template.version}
                </span>
              </div>
              <span className={`level level-${looked.template.status === 'active' ? 'signed' : 'empty'}`}>
                {looked.template.status}
              </span>
            </div>

            {looked.template.provisional && (
              <p className="q setnote">
                Marked provisional: <b>{looked.template.sourceNote}</b>. The list of required documents has a source
                hierarchy, and a list whose source cannot be named must not look confirmed.
              </p>
            )}

            <ul className="remlist" style={{ marginTop: 12 }}>
              {looked.items.map((i) => (
                <li key={i.slotCode} className="rem">
                  <span className={`level level-${i.required ? 'in-progress' : 'empty'}`}>
                    {i.required ? 'Required' : 'Optional'}
                  </span>
                  <div className="rem-main">
                    <div className="rem-title">
                      <b>{i.name}</b>
                      <span className="q"> · {i.slotCode}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}

      <h2 className="h2">Make a new set</h2>

      {building ? (
        <Panel
          title="New document set"
          explain="It is published straight away so contracts can use it. To change it later you make a new version — the old one keeps working for contracts already on it."
          onCancel={() => {
            setBuilding(false);
            setProblem(null);
          }}
        >
          <Field
            id="set-code"
            label="Short code"
            hint="Lowercase, no spaces. You type this when attaching the set to a contract."
            value={newCode}
            onChange={setNewCode}
            placeholder="roads-standard"
            autoFocus
          />
          <Field
            id="set-name"
            label="Full name"
            hint="What this set is for."
            value={newName}
            onChange={setNewName}
            placeholder="Roads — standard document set"
          />

          <div className="field">
            <label>Documents in the set</label>
            <span className="q hint">
              Required documents count towards the completion figure. Optional ones are tracked but never move it.
            </span>
          </div>

          <ul className="draftlist">
            {rows.map((r, i) => (
              <li key={i} className="draftrow">
                <input
                  aria-label={`Short code for document ${i + 1}`}
                  placeholder="qcp"
                  value={r.slotCode}
                  onChange={(e) =>
                    setRows(rows.map((x, j) => (i === j ? { ...x, slotCode: e.target.value } : x)))
                  }
                />
                <input
                  aria-label={`Name for document ${i + 1}`}
                  placeholder="Quality Control Program"
                  value={r.name}
                  onChange={(e) => setRows(rows.map((x, j) => (i === j ? { ...x, name: e.target.value } : x)))}
                />
                <label className="req">
                  <input
                    type="checkbox"
                    checked={r.required}
                    onChange={(e) =>
                      setRows(rows.map((x, j) => (i === j ? { ...x, required: e.target.checked } : x)))
                    }
                  />
                  Required
                </label>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={rows.length === 1}
                  title={rows.length === 1 ? 'A set needs at least one document' : undefined}
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>

          <div className="actions">
            <Action label="Add another document" onClick={() => setRows([...rows, { ...BLANK }])} />
            <Action
              label="Create and publish"
              kind="primary"
              disabled={!newCode.trim() || !newName.trim() || usable.length === 0}
              why="Give the set a code, a name, and at least one document"
              onClick={create}
            />
          </div>
        </Panel>
      ) : (
        <div className="actions">
          <Action label="Make a new set" kind="primary" onClick={() => setBuilding(true)} />
        </div>
      )}
    </div>
  );
}
