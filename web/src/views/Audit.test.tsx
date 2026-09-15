/**
 * The audit trail.
 *
 * The one thing this screen must never do is list a tamper-evident log without
 * saying whether it currently holds — and when it does not hold, it has to name
 * the row it breaks at. "Something is wrong somewhere" is not actionable on a
 * chain whose whole value is that a break has a known location.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import Audit from './Audit';
import { days, when } from './bits';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const event = (over = {}) => ({
  id: '12',
  occurredAt: '2026-09-15T03:24:00.000Z',
  actorId: 'operator:single',
  actorRole: 'admin',
  action: 'document.final',
  subjectType: 'document',
  subjectId: 'a45994c7-3ce1-4a03-aab9-fa96d90dabb2',
  detail: { from: 'Draft', to: 'Final' },
  prevHash: 'aaa',
  hash: 'bbbbbbbbbbbbbbbbbbbb',
  ...over,
});

const stub = (events: unknown[], chain: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => (url.startsWith('/audit/verify') ? json(chain) : json({ events }))),
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('chain verification', () => {
  it('says the chain is intact, and how much was checked', async () => {
    stub([event()], { ok: true, checked: 30, brokenAt: null, reason: null });
    render(<Audit />);

    await waitFor(() => expect(screen.getByText('Chain intact.')).toBeTruthy());
    expect(screen.getByText(/30 events recomputed in order/)).toBeTruthy();
    expect(document.querySelector('.chain-ok')).toBeTruthy();
    expect(document.querySelector('.chain-bad')).toBeNull();
  });

  it('names the row a break happens at, not merely that one happened', async () => {
    stub([event()], { ok: false, checked: 11, brokenAt: '12', reason: 'row content does not match its hash' });
    render(<Audit />);

    await waitFor(() => expect(screen.getByText('Chain broken.')).toBeTruthy());
    expect(screen.getByText(/event 12 failed: row content does not match its hash/)).toBeTruthy();
    expect(document.querySelector('.chain-bad')).toBeTruthy();
  });

  it('gets the singular right for a chain of one', async () => {
    stub([event()], { ok: true, checked: 1, brokenAt: null, reason: null });
    render(<Audit />);
    await waitFor(() => expect(screen.getByText(/1 event recomputed/)).toBeTruthy());
  });

  it('offers to re-verify', async () => {
    stub([event()], { ok: true, checked: 2, brokenAt: null, reason: null });
    render(<Audit />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Re-verify/ })).toBeTruthy());
  });
});

describe('the events', () => {
  it('shows the newest first', async () => {
    stub(
      [event({ id: '1', action: 'project.created' }), event({ id: '2', action: 'document.final' })],
      { ok: true, checked: 2, brokenAt: null, reason: null },
    );
    render(<Audit />);

    await waitFor(() => expect(document.querySelectorAll('.remlist li')).toHaveLength(2));
    const actions = [...document.querySelectorAll('.remlist .level')].map((e) => e.textContent);
    expect(actions).toEqual(['document.final', 'project.created']);
  });

  it('records who acted and under which role', async () => {
    stub([event()], { ok: true, checked: 1, brokenAt: null, reason: null });
    render(<Audit />);
    await waitFor(() => expect(screen.getByText(/operator:single as admin/)).toBeTruthy());
  });

  it('says nothing is recorded rather than showing a blank list', async () => {
    stub([], { ok: true, checked: 0, brokenAt: null, reason: null });
    render(<Audit />);
    await waitFor(() => expect(screen.getByText(/Nothing recorded yet/)).toBeTruthy());
  });

  it('reports a failure rather than an empty trail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500, statusText: 'Server Error' })));
    render(<Audit />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByText(/Nothing recorded yet/)).toBeNull();
    expect(screen.queryByText(/Chain intact/)).toBeNull();
  });
});

describe('shared formatting', () => {
  it('counts days from a timestamp', () => {
    expect(days(new Date(Date.now() - 3 * 86_400_000).toISOString())).toBe('3 days');
    expect(days(new Date(Date.now() - 86_400_000).toISOString())).toBe('1 day');
    expect(days(new Date(Date.now() - 3600_000).toISOString())).toBe('1 hour');
  });

  /** A future timestamp is clock skew or a bad row, not a negative age. */
  it('never reports a negative age', () => {
    expect(days(new Date(Date.now() + 5 * 86_400_000).toISOString())).toBe('under an hour');
  });

  it('hands back anything it cannot parse, rather than "Invalid Date"', () => {
    expect(days('not-a-date')).toBe('not-a-date');
    expect(when('not-a-date')).toBe('not-a-date');
  });
});
