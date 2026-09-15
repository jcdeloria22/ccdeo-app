/**
 * What the browser is allowed to see.
 *
 * The failure that matters here is showing the app to someone who is not signed
 * in, so these check the gate from the outside: what the server answers decides
 * what renders, and nothing the browser believes about itself can override it.
 *
 * The single-operator case is checked first and deliberately — authentication
 * must not change the loopback build that is in daily use.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Session from './Session';
import { AUTH_EXPIRED } from './api';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ME = {
  user: { id: 'u1', name: 'Temp Engineer', email: 'temp@dpwh.gov.ph', role: 'materials_engineer' },
  mustChangePassword: false,
  authMode: 'password' as const,
};

/** Everything the Shell fetches once it renders, so it does not error. */
function shellRoutes(url: string): Response | null {
  if (url.startsWith('/reminders/counts')) return json({ unread: 0, unreadOverdue: 0, unreadWarning: 0, total: 0 });
  if (url.startsWith('/reminders')) return json({ items: [], counts: { unread: 0, unreadOverdue: 0, unreadWarning: 0, total: 0 } });
  if (url.startsWith('/lifecycle')) return json({ states: [], terminal: [], mainLine: [], transitions: [] });
  return null;
}

interface Answers {
  mode?: 'none' | 'password';
  me?: () => Response;
  login?: () => Response;
}

function stub(answers: Answers = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === '/auth/mode') return json({ authMode: answers.mode ?? 'password' });
      if (url === '/auth/me') return answers.me ? answers.me() : json(ME);
      if (url === '/auth/login') return answers.login ? answers.login() : json({ user: ME.user, mustChangePassword: false });
      if (url === '/auth/logout') return json({ ok: true });
      if (url === '/auth/change-password') return json({ ok: true });
      const shell = shellRoutes(url);
      if (shell) return shell;
      throw new Error(`unstubbed ${url}`);
    }),
  );
  return calls;
}

beforeEach(() => {
  document.title = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a build with no accounts', () => {
  /** The loopback build is the one in daily use; auth must not disturb it. */
  it('never asks who you are, and never shows a login screen', async () => {
    const calls = stub({ mode: 'none' });
    render(<Session />);

    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Sections' })).toBeTruthy());
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(calls.some((c) => c.includes('/auth/me')), 'must not ask /auth/me when there are no accounts').toBe(false);
  });

  it('still says which arrangement is in force', async () => {
    stub({ mode: 'none' });
    render(<Session />);
    await waitFor(() => expect(screen.getByText('Single operator')).toBeTruthy());
  });
});

describe('a build with accounts', () => {
  it('shows the login screen when the server says nobody is signed in', async () => {
    stub({ me: () => json({ message: 'no actor' }, 401) });
    render(<Session />);

    await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy());
    expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull();
  });

  it('shows the app when the server says you are', async () => {
    stub();
    render(<Session />);

    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Sections' })).toBeTruthy());
    expect(screen.getByText('Temp Engineer')).toBeTruthy();
    expect(screen.getByText('temp@dpwh.gov.ph')).toBeTruthy();
  });

  /** Who you are acting as decides what you may do; it should not be a mystery. */
  it('names the role acts are performed under', async () => {
    stub();
    render(<Session />);
    await waitFor(() => expect(screen.getByText('acting as materials engineer')).toBeTruthy());
  });

  it('shows the password form when the account is on an issued password', async () => {
    stub({ me: () => json({ ...ME, mustChangePassword: true }) });
    render(<Session />);

    await waitFor(() => expect(screen.getByText('Choose your own password')).toBeTruthy());
    expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull();
  });

  /**
   * The server may refuse with 403 and a code rather than answering `/auth/me`.
   * The gate must route on the code, not on the prose of the message.
   */
  it('routes on the server’s code, not its wording', async () => {
    stub({
      me: () => json({ statusCode: 403, code: 'password_change_required', message: 'anything at all' }, 403),
    });
    render(<Session />);
    await waitFor(() => expect(screen.getByText('Choose your own password')).toBeTruthy());
  });

  it('says so when the server cannot be reached, rather than showing a login form', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('connection refused'); }));
    render(<Session />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByLabelText('Email')).toBeNull();
  });
});

describe('signing in and out', () => {
  it('asks the server again after a successful sign-in, rather than trusting the form', async () => {
    let signedIn = false;
    stub({
      me: () => (signedIn ? json(ME) : json({ message: 'no actor' }, 401)),
      login: () => {
        signedIn = true;
        return json({ user: ME.user, mustChangePassword: false });
      },
    });

    render(<Session />);
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy());

    await userEvent.type(screen.getByLabelText('Email'), 'temp@dpwh.gov.ph');
    await userEvent.type(screen.getByLabelText('Password'), 'a long enough passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Sections' })).toBeTruthy());
  });

  it('shows the server’s refusal and stays on the form', async () => {
    stub({
      me: () => json({ message: 'no actor' }, 401),
      login: () => json({ message: 'That email and password do not match an account.' }, 401),
    });

    render(<Session />);
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy());

    await userEvent.type(screen.getByLabelText('Email'), 'temp@dpwh.gov.ph');
    await userEvent.type(screen.getByLabelText('Password'), 'the wrong passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/do not match an account/)).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
  });

  /** The password is of no further use and should not sit in memory. */
  it('clears the password field after a refusal', async () => {
    stub({
      me: () => json({ message: 'no actor' }, 401),
      login: () => json({ message: 'nope' }, 401),
    });

    render(<Session />);
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy());

    await userEvent.type(screen.getByLabelText('Email'), 'temp@dpwh.gov.ph');
    const password = screen.getByLabelText('Password') as HTMLInputElement;
    await userEvent.type(password, 'the wrong passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(password.value).toBe('');
  });

  it('returns to the login screen on sign-out', async () => {
    stub();
    render(<Session />);
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Sections' })).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy());
  });

  /**
   * Whatever the server answers, this browser is done with the session. A failed
   * sign-out that left the app on screen would be the worst of both.
   */
  it('signs out locally even when the server call fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/auth/mode') return json({ authMode: 'password' });
        if (url === '/auth/me') return json(ME);
        if (url === '/auth/logout') throw new TypeError('connection refused');
        const shell = shellRoutes(url);
        if (shell) return shell;
        throw new Error(`unstubbed ${url}`);
      }),
    );

    render(<Session />);
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Sections' })).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy());
  });
});

describe('a session that ends while the app is open', () => {
  /**
   * An administrator revokes a session, or it simply expires. The next request
   * 401s and the app must not keep showing a register the server will no longer
   * answer for.
   */
  it('returns to the login screen when the server reports the session gone', async () => {
    stub();
    render(<Session />);
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Sections' })).toBeTruthy());

    window.dispatchEvent(new CustomEvent(AUTH_EXPIRED));

    await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy());
    expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull();
  });

  it('ignores the signal on a build with no accounts, which has no session to lose', async () => {
    stub({ mode: 'none' });
    render(<Session />);
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Sections' })).toBeTruthy());

    window.dispatchEvent(new CustomEvent(AUTH_EXPIRED));

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeTruthy();
    expect(screen.queryByLabelText('Email')).toBeNull();
  });
});

describe('the tab title', () => {
  it('names the login screen rather than keeping the last section', async () => {
    document.title = 'Readiness — DPWH document control';
    stub({ me: () => json({ message: 'no actor' }, 401) });

    render(<Session />);
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy());
    expect(document.title).toBe('Sign in — DPWH document control');
  });
});
