/**
 * Readiness.
 *
 *   > Readiness counts Signed only, never Final. Approval debt is displayed
 *   > separately and never folded into a completion percentage.
 *
 * The screen keeps that separation visually, not only arithmetically: the bar
 * shows what is closed out, and what is waiting for a signature is a second
 * figure beside it in a different colour. They are never stacked into one bar,
 * because a stacked bar is an invitation to read the total as progress.
 */
import { useEffect, useState } from 'react';
import { readinessApi, ApiError, type ApprovalDebtItem, type ProjectReadiness } from '../api';
import { Loading, Failed, Empty, days } from './bits';

export default function Readiness() {
  const [projects, setProjects] = useState<ProjectReadiness[] | null>(null);
  const [debt, setDebt] = useState<ApprovalDebtItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const [p, d] = await Promise.all([readinessApi.portfolio(), readinessApi.debt()]);
      setProjects(p.projects);
      setDebt(d.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (error) return <Failed message={error} onRetry={() => void load()} />;
  if (projects === null) return <Loading />;

  const tracked = projects.filter((p) => p.readiness.requiredTotal > 0);
  const totalRequired = tracked.reduce((n, p) => n + p.readiness.requiredTotal, 0);
  const totalClosed = tracked.reduce((n, p) => n + p.readiness.closedOut, 0);

  return (
    <div className="view">
      <header className="vhead">
        <h1>Readiness</h1>
        <span className="q">Signed counts. Final does not.</span>
      </header>

      <div className="cards">
        <div>
          <div className="lbl q">Contracts</div>
          <div className="figure">{projects.length}</div>
        </div>
        <div>
          <div className="lbl q">Slots closed out</div>
          <div className="figure">
            {totalClosed}
            <small> / {totalRequired}</small>
          </div>
        </div>
        <div>
          <div className="lbl q">Awaiting signature</div>
          <div className={`figure ${debt.length ? 'warn' : ''}`}>{debt.length}</div>
        </div>
        <div>
          <div className="lbl q">Complete</div>
          <div className="figure">{projects.filter((p) => p.readiness.complete).length}</div>
        </div>
      </div>

      <h2 className="h2">By contract</h2>
      {projects.length === 0 ? (
        <Empty title="No contracts yet." body="A contract appears here once it has a slot set." />
      ) : (
        <ul className="plist">
          {projects.map((p) => (
            <li key={p.projectId} className="prow">
              <div className="prow-head">
                <a className="prow-title" href={`#/register/${p.projectId}`}>
                  <b>{p.contractId}</b> <span className="q">{p.name}</span>
                </a>
                <span className="prow-pct">
                  {p.readiness.percent === null ? (
                    <span className="q">no set</span>
                  ) : (
                    <>
                      {p.readiness.percent}
                      <small>%</small>
                    </>
                  )}
                </span>
              </div>

              <div className="meter">
                <i style={{ width: `${p.readiness.percent ?? 0}%` }} />
              </div>

              <div className="prow-meta q">
                {p.readiness.signed} signed · {p.readiness.waived} waived
                {p.readiness.awaitingApproval > 0 && (
                  <span className="debt"> · {p.readiness.awaitingApproval} awaiting signature</span>
                )}
                {p.readiness.inProgress > 0 && ` · ${p.readiness.inProgress} in progress`}
                {p.readiness.empty > 0 && ` · ${p.readiness.empty} not started`}
                {p.readiness.optionalTotal > 0 && (
                  <span> · {p.readiness.optionalTotal} optional, outside the figure</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 className="h2">
        Approval debt
        {debt.length > 0 && <span className="badge badge-overdue">{debt.length}</span>}
      </h2>
      <p className="q note">
        Finished work waiting on one signature. Counted nowhere above — a document at Final is not readiness.
      </p>

      {debt.length === 0 ? (
        <Empty title="Nothing waiting." body="No document is sitting at Final." />
      ) : (
        <ul className="remlist">
          {debt.map((d) => (
            <li key={d.documentId} className="rem">
              <span className="level level-warning">Final</span>
              <div className="rem-main">
                <div className="rem-title">
                  <b>{d.contractId}</b>
                  <span className="q"> · {d.slotCode} · {d.title}</span>
                </div>
                <div className="rem-meta q">waiting {days(d.since)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
