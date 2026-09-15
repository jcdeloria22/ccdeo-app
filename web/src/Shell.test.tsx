/**
 * The shell: routing, and the nav badge.
 *
 * Reminders being the home tab is a product decision, not a default, so it is
 * asserted rather than assumed — an unknown or empty hash lands there.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Shell from './Shell';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** Answers every endpoint the shell and its views reach for on mount. */
const stubApi = (over: Record<string, unknown> = {}) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/reminders/counts')) return json(over.counts ?? { unread: 4, unreadOverdue: 3, unreadWarning: 1, total: 9 });
      if (url.startsWith('/reminders')) return json({ items: [], counts: { unread: 4, unreadOverdue: 3, unreadWarning: 1, total: 9 } });
      if (url.startsWith('/readiness/debt')) return json({ items: [] });
      if (url.startsWith('/readiness')) return json({ projects: [] });
      if (url.startsWith('/projects')) return json({ rows: [], total: 0 });
      if (url.startsWith('/audit/verify')) return json({ ok: true, checked: 30, brokenAt: null, reason: null });
      if (url.startsWith('/audit')) return json({ events: [] });
      if (url.startsWith('/lifecycle')) {
        return json({ states: [], terminal: [], mainLine: ['Draft', 'Final', 'Signed'], transitions: [] });
      }
      if (url.startsWith('/slot-templates')) return json({ template: null, items: [] });
      throw new Error(`unstubbed ${url}`);
    }),
  );

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('routing', () => {
  it('lands on Reminders with no hash — the home tab is what needs you', async () => {
    stubApi();
    render(<Shell />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Reminders/));
    expect(screen.getByRole('button', { name: /Reminders/ })).toHaveProperty('ariaCurrent', 'page');
  });

  it('lands on Reminders for a hash that names no tab', async () => {
    window.location.hash = '#/nonsense';
    stubApi();
    render(<Shell />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Reminders/));
  });

  it('opens the tab named in the hash', async () => {
    window.location.hash = '#/audit';
    stubApi();
    render(<Shell />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Audit'));
  });

  it('moves between tabs and marks the current one', async () => {
    stubApi();
    const user = userEvent.setup();
    render(<Shell />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Readiness' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Readiness'));
    expect(window.location.hash).toBe('#/readiness');
    expect(screen.getByRole('button', { name: 'Readiness' })).toHaveProperty('ariaCurrent', 'page');
    expect(screen.getByRole('button', { name: /Reminders/ }).ariaCurrent).toBeNull();
  });

  /**
   * Pinned deliberately. A tab added without a decision is how a shell turns
   * into a drawer of everything, so a new section has to be added here too.
   */
  it('offers exactly these sections, in the order of the day', async () => {
    stubApi();
    render(<Shell />);
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    const labels = [...nav.querySelectorAll('.navbtn .lb')].map((e) => e.textContent);
    expect(labels).toEqual([
      'Reminders',
      'Readiness',
      'Register',
      'Document Builder',
      'Document sets',
      'ME Workflow',
      'ME Reviewer',
      'PE Reviewer',
      'Audit',
    ]);
  });

  /** `#/register/<id>` is the only route that carries anything. */
  it('passes a project id through to the register', async () => {
    window.location.hash = '#/register/abc-123';
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('/reminders/counts')) return json({ unread: 0, unreadOverdue: 0, unreadWarning: 0, total: 0 });
      if (url.startsWith('/lifecycle')) {
        return json({ states: [], terminal: [], mainLine: ['Draft', 'Final', 'Signed'], transitions: [] });
      }
      if (url === '/projects/abc-123') {
        return json({
          project: { id: 'abc-123', contractId: '26HH0041', name: 'Barangay Road' },
          readiness: null,
          slots: [],
          documents: [],
        });
      }
      throw new Error(`unstubbed ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<Shell />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('26HH0041'));
  });
});

describe('the nav badge', () => {
  it('shows the unread count on the Reminders tab', async () => {
    stubApi();
    render(<Shell />);
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    await waitFor(() => expect(nav.querySelector('.badge')?.textContent).toBe('4'));
  });

  it('shows nothing when there is nothing unread', async () => {
    stubApi({ counts: { unread: 0, unreadOverdue: 0, unreadWarning: 0, total: 5 } });
    render(<Shell />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeTruthy());
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    expect(nav.querySelector('.badge')).toBeNull();
  });

  /**
   * The count must be right while you are looking at another tab — that is the
   * entire point of putting it on the nav rather than inside the view.
   */
  it('is present on a tab other than Reminders', async () => {
    window.location.hash = '#/audit';
    stubApi();
    render(<Shell />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Audit'));
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    expect(nav.querySelector('.badge')?.textContent).toBe('4');
  });

  /** A badge is not worth an error screen; the tab itself reports the failure. */
  it('stays quiet when the count cannot be fetched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('/reminders/counts')) return new Response('nope', { status: 500 });
        return json({ items: [], counts: { unread: 0, unreadOverdue: 0, unreadWarning: 0, total: 0 } });
      }),
    );
    render(<Shell />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeTruthy());
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    expect(nav.querySelector('.badge')).toBeNull();
  });
});
