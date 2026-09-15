/**
 * The reminders tab.
 *
 * It answers one question — *what needs me* — so it is ordered by that and
 * nothing else: unread before read, overdue before warning, oldest before
 * newest. The readiness dashboard answers a different question and lives
 * elsewhere, deliberately.
 *
 * Every state the screen can be in is drawn: loading, failed, empty, all-read,
 * and the list. An inbox that renders blank on a failed request would look
 * exactly like "nothing needs you", which is the one thing this screen must
 * never say by accident.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, writeApi, ApiError, type InboxCounts, type InboxItem } from '../api';

type Filter = 'unread' | 'all';
type Load = { status: 'loading' } | { status: 'ok' } | { status: 'failed'; message: string };

const EMPTY_COUNTS: InboxCounts = { unread: 0, unreadOverdue: 0, unreadWarning: 0, total: 0 };

/** "3 days", "20 days", "4 hours" — the unit people actually think in. */
export function age(days: number): string {
  if (days < 1 / 24) return 'under an hour';
  if (days < 1) {
    const h = Math.round(days * 24);
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  const d = Math.round(days);
  return `${d} day${d === 1 ? '' : 's'}`;
}

/**
 * The stored reason is a self-contained sentence — "Final for 22.0 days — approval
 * debt, frozen and waiting on the approver alone" — because it is a record that
 * has to make sense on its own, away from any screen.
 *
 * Here it is next to the same state and age rendered as structured fields, so the
 * first half would say everything twice. Only the explanation is shown, and the
 * whole string is used if it is not in the expected shape.
 */
export function explanation(reason: string): string {
  const i = reason.indexOf('\u2014');
  return i >= 0 ? reason.slice(i + 1).trim() : reason;
}

export function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function Badge({ n, tone }: { n: number; tone: 'overdue' | 'warning' }) {
  if (n === 0) return null;
  return (
    <span className={`badge badge-${tone}`} aria-label={`${n} ${tone}`}>
      {n}
    </span>
  );
}

function Row({ item, onAcknowledge, busy }: { item: InboxItem; onAcknowledge: (id: string) => void; busy: boolean }) {
  const read = item.acknowledgedAt !== null;
  return (
    <li className={`rem ${read ? 'rem-read' : ''}`}>
      <span className={`level level-${item.level}`}>{item.level === 'overdue' ? 'Overdue' : 'Warning'}</span>

      <div className="rem-main">
        <div className="rem-title">
          <b>{item.contractId}</b>
          <span className="q"> · {item.slotCode}</span>
          <span className="q"> · {item.title}</span>
        </div>
        <div className="rem-reason q">{explanation(item.reason)}</div>
        <div className="rem-meta q">
          {item.state} for {age(item.ageDays)} · raised {when(item.raisedAt)}
          {read && item.acknowledgedAt ? ` · read ${when(item.acknowledgedAt)}` : ''}
        </div>
      </div>

      <div className="rem-act">
        {read ? (
          <span className="q read-mark" aria-label="Already read">
            Read
          </span>
        ) : (
          <button
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={() => onAcknowledge(item.reminderId)}
          >
            Mark read
          </button>
        )}
      </div>
    </li>
  );
}

export default function Reminders({ onCountsChanged }: { onCountsChanged?: (unread: number) => void }) {
  const [filter, setFilter] = useState<Filter>('unread');
  const [items, setItems] = useState<InboxItem[]>([]);
  const [counts, setCounts] = useState<InboxCounts>(EMPTY_COUNTS);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [busy, setBusy] = useState<string | null>(null);

  /*
   * Two things go wrong when a refresh captures the filter it was created under.
   *
   * Marking one read refreshes the list; switching filter refreshes it too. The
   * acknowledge handler holds the `refresh` from the render it was created in, so
   * a click followed immediately by a filter change re-fetched the OLD filter and
   * wrote it over the new view — the All tab showing only unread rows.
   *
   * So the filter is read from a ref at call time rather than closed over, and
   * `refresh` is stable. The sequence number then covers the remaining case:
   * responses arriving out of order, where an older request lands last.
   */
  const seq = useRef(0);
  const filterRef = useRef<Filter>(filter);

  /* Held in a ref so `refresh` stays stable and the effect does not re-run
     whenever the shell hands down a new closure. */
  const onCountsChangedRef = useRef(onCountsChanged);
  useEffect(() => {
    onCountsChangedRef.current = onCountsChanged;
  }, [onCountsChanged]);
  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const res = await api.inbox({ unread: filterRef.current === 'unread' });
      if (mine !== seq.current) return;
      setItems(res.items);
      setCounts(res.counts);
      onCountsChangedRef.current?.(res.counts.unread);
      setLoad({ status: 'ok' });
    } catch (e) {
      if (mine !== seq.current) return;
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      setLoad({ status: 'failed', message: msg });
    }
  }, []);

  useEffect(() => {
    setLoad({ status: 'loading' });
    void refresh();
  }, [filter, refresh]);

  const acknowledge = async (id: string) => {
    setBusy(id);
    try {
      await api.acknowledge(id);
      await refresh();
    } catch (e) {
      setLoad({ status: 'failed', message: e instanceof ApiError ? e.message : (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  /**
   * Run the ageing engine, then reload.
   *
   * On a server with a scheduler this would happen on its own; with one operator
   * and no cron there is nothing to trigger it, so the inbox would stay empty
   * however long a document sat. Pressing it twice is harmless — a reminder
   * already raised for the same wait is not raised again.
   */
  const check = async () => {
    setBusy('check');
    try {
      await writeApi.runReminders();
      await refresh();
    } catch (e) {
      setLoad({ status: 'failed', message: e instanceof ApiError ? e.message : (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const acknowledgeAll = async () => {
    setBusy('all');
    try {
      await api.acknowledgeAll();
      await refresh();
    } catch (e) {
      setLoad({ status: 'failed', message: e instanceof ApiError ? e.message : (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="view">
      <header className="vhead">
        <h1>
          Reminders
          <Badge n={counts.unreadOverdue} tone="overdue" />
          <Badge n={counts.unreadWarning} tone="warning" />
        </h1>
        <span className="q">what needs you — not whether a project is ready</span>
      </header>

      <div className="cards" aria-label="Inbox summary">
        <div>
          <div className="lbl q">Unread</div>
          <div className={`figure ${counts.unread ? 'warn' : ''}`}>{counts.unread}</div>
        </div>
        <div>
          <div className="lbl q">Overdue</div>
          <div className={`figure ${counts.unreadOverdue ? 'warn' : ''}`}>{counts.unreadOverdue}</div>
        </div>
        <div>
          <div className="lbl q">Warning</div>
          <div className="figure">{counts.unreadWarning}</div>
        </div>
        <div>
          <div className="lbl q">Raised, all time</div>
          <div className="figure">{counts.total}</div>
        </div>
      </div>

      <div className="bar">
        <div className="chipgroup" role="group" aria-label="Filter">
          <button className="chip" aria-pressed={filter === 'unread'} onClick={() => setFilter('unread')}>
            Unread
          </button>
          <button className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            All
          </button>
        </div>

        <div className="bar-right">
          <button
            className="btn btn-secondary btn-sm"
            title="Looks at every document and raises a reminder for anything that has sat too long"
            onClick={() => void check()}
            disabled={busy !== null}
          >
            {busy === 'check' ? 'Checking…' : 'Check now'}
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => void acknowledgeAll()}
            disabled={busy !== null || counts.unread === 0}
          >
            Mark all read
          </button>
        </div>
      </div>

      {load.status === 'loading' && <p className="q state">Loading…</p>}

      {load.status === 'failed' && (
        <div className="card state-bad" role="alert">
          <b>Could not load reminders.</b>
          <div className="q">{load.message}</div>
          <button className="btn btn-secondary btn-sm" onClick={() => void refresh()} style={{ marginTop: 12 }}>
            Try again
          </button>
        </div>
      )}

      {load.status === 'ok' && items.length === 0 && (
        <div className="card state">
          {counts.total === 0 ? (
            <>
              <b>Nothing has been raised.</b>
              <div className="q">
                Reminders appear here when a document sits past its clock — Draft 14/30, In Review 5/10, Final 3/7
                calendar days.
              </div>
            </>
          ) : filter === 'unread' ? (
            <>
              <b>Nothing unread.</b>
              <div className="q">
                {counts.total} reminder{counts.total === 1 ? '' : 's'} on record. Switch to All to see them.
              </div>
            </>
          ) : (
            <b>Nothing to show.</b>
          )}
        </div>
      )}

      {load.status === 'ok' && items.length > 0 && (
        <ul className="remlist">
          {items.map((i) => (
            <Row key={i.reminderId} item={i} onAcknowledge={(id) => void acknowledge(id)} busy={busy !== null} />
          ))}
        </ul>
      )}
    </div>
  );
}
