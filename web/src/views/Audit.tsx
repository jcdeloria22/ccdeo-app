/**
 * The audit trail.
 *
 * The chain verification is at the top and runs on load, because listing a
 * tamper-evident log without saying whether it currently holds is the one thing
 * this screen must not do. A broken chain is reported with the row it breaks at,
 * not as a general failure — "something is wrong somewhere" is not actionable.
 */
import { useEffect, useState } from 'react';
import { auditApi, ApiError, type AuditEvent, type ChainVerification } from '../api';
import { Loading, Failed, Empty, when } from './bits';

export default function Audit() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [chain, setChain] = useState<ChainVerification | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const [list, verification] = await Promise.all([auditApi.list(), auditApi.verify()]);
      setEvents(list.events);
      setChain(verification);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (error) return <Failed message={error} onRetry={() => void load()} />;
  if (events === null || chain === null) return <Loading />;

  return (
    <div className="view">
      <header className="vhead">
        <h1>Audit</h1>
        <span className="q">append-only, hash-chained</span>
      </header>

      <div className={`card chain ${chain.ok ? 'chain-ok' : 'chain-bad'}`} role="status">
        <b>{chain.ok ? 'Chain intact.' : 'Chain broken.'}</b>
        <div className="q">
          {chain.ok
            ? `${chain.checked.toLocaleString()} event${chain.checked === 1 ? '' : 's'} recomputed in order; every hash matches its contents and its predecessor.`
            : `Verified ${chain.checked.toLocaleString()} event${chain.checked === 1 ? '' : 's'}, then event ${chain.brokenAt} failed: ${chain.reason}`}
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => void load()} style={{ marginTop: 12 }}>
          Re-verify
        </button>
      </div>

      <h2 className="h2">
        Events <span className="q">newest first</span>
      </h2>

      {events.length === 0 ? (
        <Empty title="Nothing recorded yet." body="Every write appends here — projects, uploads, transitions, approvals, reminders." />
      ) : (
        <ul className="remlist">
          {events
            .slice()
            .reverse()
            .map((e) => (
              <li key={e.id} className="rem">
                <span className="level level-state">{e.action}</span>
                <div className="rem-main">
                  <div className="rem-title">
                    <b>{e.subjectType}</b>
                    {e.subjectId && <span className="q"> · {e.subjectId.slice(0, 8)}…</span>}
                  </div>
                  {Object.keys(e.detail ?? {}).length > 0 && (
                    <div className="rem-reason q mono">{JSON.stringify(e.detail)}</div>
                  )}
                  <div className="rem-meta q">
                    {when(e.occurredAt)} · {e.actorId} as {e.actorRole} · hash {e.hash.slice(0, 12)}…
                  </div>
                </div>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
