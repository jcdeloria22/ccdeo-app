/**
 * Where a document has got to, and what can happen next.
 *
 * The transition table comes from the server, so this cannot offer a move the
 * machine would refuse, or hide one it would allow. Anyone meeting the lifecycle
 * for the first time should be able to read it off the screen: the path, the
 * point the document has reached, and the reason a move is unavailable when it is.
 */
import { useState } from 'react';
import type { DocumentState, Transition } from '../api';
import { Action, Field, Problem } from './bits';

export function Track({ state, mainLine }: { state: DocumentState; mainLine: readonly string[] }) {
  const here = mainLine.indexOf(state);

  // Void and Superseded are branches, not points on the path.
  if (here < 0) {
    return (
      <div className="track">
        <span className="track-step track-off">{state}</span>
        <span className="q track-note">
          {state === 'Void' ? 'Cancelled. Nothing leaves this state.' : 'Replaced by a newer version.'}
        </span>
      </div>
    );
  }

  return (
    <ol className="track">
      {mainLine.map((s, i) => (
        <li
          key={s}
          className={`track-step ${i === here ? 'track-now' : i < here ? 'track-done' : 'track-todo'}`}
          aria-current={i === here ? 'step' : undefined}
        >
          {s}
        </li>
      ))}
    </ol>
  );
}

/** Plain-language labels. "Transition to Final" is not what anyone calls this. */
const VERB: Record<string, string> = {
  'In Review': 'Send for review',
  Final: 'Finalize',
  Signed: 'Sign it off',
  Draft: 'Send back',
  Archived: 'Archive',
  Void: 'Cancel',
  Superseded: 'Mark superseded',
};

/** The database's role names, as people say them. */
const ROLE: Record<string, string> = {
  admin: 'an administrator',
  materials_engineer: 'the Materials Engineer',
  approver: 'the approver',
  project_engineer: 'the Project Engineer',
  viewer: 'a viewer',
};

const roleList = (roles: readonly string[]): string =>
  roles.map((r) => ROLE[r] ?? r).join(' or ');

const EXPLAIN: Record<string, string> = {
  'In Review': 'Marks it as ready for someone to check.',
  Final: 'Freezes the file. Nothing about it can change after this without a new version.',
  Signed: 'Records the approval against the exact file that was frozen. This is the signature.',
  Draft: 'Returns it to the author. You must say why.',
  Archived: 'Closes it out. Nothing leaves this state.',
  Void: 'Cancels it for good. You must say why, and only an approver can do this.',
  Superseded: 'Marks it replaced by a newer version.',
};

export function NextSteps({
  state,
  transitions,
  onMove,
}: {
  state: DocumentState;
  transitions: readonly Transition[];
  onMove: (to: DocumentState, reason?: string) => Promise<void>;
}) {
  const [asking, setAsking] = useState<DocumentState | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);

  const available = transitions.filter((t) => t.from === state);

  if (available.length === 0) {
    return (
      <p className="q nextnote">
        Nothing more can happen to this document — <b>{state}</b> is final.
      </p>
    );
  }

  const run = async (to: DocumentState, why?: string) => {
    setError(null);
    try {
      await onMove(to, why);
      setAsking(null);
      setReason('');
    } catch (e) {
      setError(e);
    }
  };

  return (
    <div className="next">
      <Problem error={error} onDismiss={() => setError(null)} />

      {asking ? (
        <div className="panel">
          <div className="panel-head">
            <b>{VERB[asking] ?? asking}</b>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setAsking(null);
                setReason('');
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
          <p className="q explain">
            {EXPLAIN[asking]} The reason is kept on the record permanently and cannot be edited later.
          </p>
          <Field
            id="move-reason"
            label="Reason"
            hint="Say what is wrong or why this is being cancelled."
            value={reason}
            onChange={setReason}
            placeholder="e.g. Sieve analysis missing from the annex"
            autoFocus
          />
          <Action
            label={VERB[asking] ?? asking}
            kind="primary"
            disabled={!reason.trim()}
            why="Type a reason first"
            onClick={() => run(asking, reason)}
          />
        </div>
      ) : (
        <>
          <div className="q nextnote">What can happen next:</div>
          <div className="actions">
            {available.map((t) => (
              <Action
                key={t.to}
                label={VERB[t.to] ?? `Move to ${t.to}`}
                kind={t.isApproval ? 'primary' : 'secondary'}
                onClick={() => (t.requiresReason ? Promise.resolve(setAsking(t.to)) : run(t.to))}
              />
            ))}
          </div>
          <ul className="whatnext q">
            {available.map((t) => (
              <li key={t.to}>
                <b>{VERB[t.to] ?? t.to}</b> — {EXPLAIN[t.to] ?? t.note}
                {t.rolesAllowed && <> Only {roleList(t.rolesAllowed)} may do this.</>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
