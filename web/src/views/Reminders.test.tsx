/**
 * The reminders screen.
 *
 * Beyond the obvious rendering, two things here are regression tests for real
 * bugs found by driving the browser: the duplicated age line, and the filter
 * race where acknowledging a reminder re-fetched the filter that was current
 * when the handler was created rather than the one on screen.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Reminders, { age, explanation, when } from './Reminders';
import type { InboxItem } from '../api';

const item = (over: Partial<InboxItem> = {}): InboxItem => ({
  reminderId: 'r1',
  documentId: 'd1',
  projectId: 'p1',
  contractId: '26HH0041',
  slotCode: 'qcp',
  title: 'QCP — Barangay Road',
  state: 'Final',
  level: 'overdue',
  ageDays: 22,
  reason: 'Final for 22.0 days — approval debt, waiting on the approver alone',
  raisedAt: '2026-09-01T03:00:00.000Z',
  acknowledgedAt: null,
  acknowledgedBy: null,
  ...over,
});

const counts = (unread: number, total: number) => ({
  unread,
  unreadOverdue: unread,
  unreadWarning: 0,
  total,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('age', () => {
  it('reads in the unit people think in', () => {
    expect(age(22)).toBe('22 days');
    expect(age(1)).toBe('1 day');
    expect(age(0.5)).toBe('12 hours');
    expect(age(1 / 24)).toBe('1 hour');
  });

  it('does not say "0 days" for something raised minutes ago', () => {
    expect(age(0.001)).toBe('under an hour');
  });
});

describe('explanation', () => {
  /**
   * The stored reason is a whole sentence because it is a record that must make
   * sense away from any screen. Beside the same state and age as structured
   * fields, the first half would say everything twice.
   */
  it('drops the part the row already shows', () => {
    expect(explanation('Final for 22.0 days — approval debt, waiting on the approver alone')).toBe(
      'approval debt, waiting on the approver alone',
    );
  });

  it('keeps the whole string when it is not in that shape', () => {
    expect(explanation('something else entirely')).toBe('something else entirely');
  });
});

describe('when', () => {
  it('returns the input unchanged if it is not a date', () => {
    expect(when('not-a-date')).toBe('not-a-date');
  });
});

describe('the screen', () => {
  it('shows what is unread, most severe first', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ items: [item(), item({ reminderId: 'r2', level: 'warning' })], counts: counts(2, 2) })),
    );
    render(<Reminders />);

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    const levels = screen.getAllByRole('listitem').map((li) => li.querySelector('.level')?.textContent);
    expect(levels).toEqual(['Overdue', 'Warning']);
  });

  it('says nothing has been raised when the register is empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [], counts: counts(0, 0) })));
    render(<Reminders />);
    await waitFor(() => expect(screen.getByText(/Nothing has been raised/)).toBeTruthy());
  });

  /** Different fact, different sentence — "all read" is not "none exist". */
  it('distinguishes nothing-unread from nothing-raised', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [], counts: counts(0, 7) })));
    render(<Reminders />);
    await waitFor(() => expect(screen.getByText(/Nothing unread/)).toBeTruthy());
    expect(screen.getByText(/7 reminders on record/)).toBeTruthy();
    expect(screen.queryByText(/Nothing has been raised/)).toBeNull();
  });

  /** A blank screen on a failed request reads as "nothing needs you". It must not. */
  it('reports a failure rather than rendering an empty inbox', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500, statusText: 'Server Error' })));
    render(<Reminders />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/Could not load reminders/)).toBeTruthy();
    expect(screen.queryByText(/Nothing has been raised/)).toBeNull();
    expect(screen.getByRole('button', { name: /Try again/ })).toBeTruthy();
  });

  it('tells the shell how many are unread, so the nav badge agrees', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [item()], counts: counts(4, 9) })));
    const onCountsChanged = vi.fn();
    render(<Reminders onCountsChanged={onCountsChanged} />);
    await waitFor(() => expect(onCountsChanged).toHaveBeenCalledWith(4));
  });

  it('disables Mark all read when there is nothing unread', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [], counts: counts(0, 3) })));
    render(<Reminders />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Mark all read/ })).toHaveProperty('disabled', true),
    );
  });

  /**
   * The regression this file exists for.
   *
   * Marking one read refreshes the list; switching filter refreshes it too. The
   * acknowledge handler used to hold the `refresh` created when the filter was
   * still Unread, so a click followed by a filter change re-fetched the OLD
   * filter and wrote it over the new view — the All tab showing only unread rows.
   */
  it('does not let a slow acknowledge overwrite a newer filter', async () => {
    const post = deferred<Response>();
    const calls: string[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(url);
        if (init?.method === 'POST') return post.promise;
        if (url.includes('unread=true')) {
          return json({ items: [item(), item({ reminderId: 'r2' })], counts: counts(2, 3) });
        }
        return json({
          items: [item(), item({ reminderId: 'r2' }), item({ reminderId: 'r3', acknowledgedAt: '2026-09-02T00:00:00Z' })],
          counts: counts(2, 3),
        });
      }),
    );

    const user = userEvent.setup();
    render(<Reminders />);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));

    // Click Mark read — its POST is held open — then immediately switch to All.
    await user.click(screen.getAllByRole('button', { name: 'Mark read' })[0]);
    await user.click(screen.getByRole('button', { name: 'All' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3));

    // Now let the acknowledge finish. Its refresh must honour the filter on
    // screen, not the one that was current when the click happened.
    post.resolve(json({ newlyAcknowledged: true, item: item() }));

    await waitFor(() => {
      const last = calls[calls.length - 1];
      expect(last).toBe('/reminders');
    });
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(calls.filter((c) => c.includes('unread=true')).length).toBe(1);
  });

  it('marks one read through the API', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return json({ newlyAcknowledged: true, item: item() });
      return json({ items: [item()], counts: counts(1, 1) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(<Reminders />);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));

    await user.click(screen.getByRole('button', { name: 'Mark read' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u, i]) => u === '/reminders/r1/acknowledge' && i?.method === 'POST')).toBe(
        true,
      ),
    );
  });

  it('shows a read reminder as read rather than offering the button again', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ items: [item({ acknowledgedAt: '2026-09-02T00:00:00Z', acknowledgedBy: 'me' })], counts: counts(0, 1) })),
    );
    render(<Reminders />);
    await waitFor(() => expect(screen.getByText('Read')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Mark read' })).toBeNull();
  });
});
