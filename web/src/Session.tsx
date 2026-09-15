/**
 * What the browser is allowed to see.
 *
 * One question decides everything: does this build use passwords? A loopback
 * single-operator build answers `none`, and then this gets out of the way
 * entirely — no login screen, no user in the rail, nothing changes. That matters,
 * because the local build is the one in daily use and authentication must not
 * make it worse.
 *
 * With `password` there are three states, and they are distinguished by what the
 * server says rather than by anything kept here:
 *
 *   401                        -> not signed in, show the login screen
 *   403 password_change_required -> signed in on an issued password, show the form
 *   200                        -> signed in, show the app
 *
 * The gate holds no opinion of its own about whether someone is signed in. It
 * asks, and it asks again whenever the server says a session has gone. A gate
 * that decided for itself would eventually disagree with the server, and the
 * direction it would fail in is showing the app to someone who is not signed in.
 */
import { useCallback, useEffect, useState } from 'react';
import { ApiError, AUTH_EXPIRED, authApi, type WhoAmI } from './api';
import Shell from './Shell';
import Login from './views/Login';
import ChangePassword from './views/ChangePassword';
import { Failed, Loading } from './views/bits';

type State =
  | { kind: 'asking' }
  | { kind: 'open' } // AUTH_MODE=none — no accounts, no gate
  | { kind: 'anonymous' }
  | { kind: 'must-change' }
  | { kind: 'signed-in'; who: WhoAmI }
  | { kind: 'unreachable'; message: string };

export default function Session() {
  const [state, setState] = useState<State>({ kind: 'asking' });

  const ask = useCallback(async () => {
    try {
      const { authMode } = await authApi.mode();
      if (authMode === 'none') {
        setState({ kind: 'open' });
        return;
      }
    } catch (e) {
      setState({ kind: 'unreachable', message: e instanceof ApiError ? e.message : (e as Error).message });
      return;
    }

    try {
      const who = await authApi.me();
      setState(who.mustChangePassword ? { kind: 'must-change' } : { kind: 'signed-in', who });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'password_change_required') {
        setState({ kind: 'must-change' });
        return;
      }
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setState({ kind: 'anonymous' });
        return;
      }
      setState({ kind: 'unreachable', message: e instanceof ApiError ? e.message : (e as Error).message });
    }
  }, []);

  useEffect(() => {
    void ask();
  }, [ask]);

  /*
   * A session can end while a screen is open. Rather than teach every view to
   * recover, the API wrapper announces a 401 and the gate asks again — which
   * lands on the login screen with the work that was on screen replaced rather
   * than a page full of failed panels.
   */
  useEffect(() => {
    const onExpired = () => {
      setState((s) => (s.kind === 'signed-in' || s.kind === 'must-change' ? { kind: 'anonymous' } : s));
    };
    window.addEventListener(AUTH_EXPIRED, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED, onExpired);
  }, []);

  /*
   * The tab's title belongs to whatever is on screen. Without this it keeps the
   * last section's name, so a session that expires on the Readiness tab leaves a
   * login screen labelled "Readiness" — a small thing that reads as a glitch and
   * makes a person wonder whether they are still signed in.
   */
  useEffect(() => {
    if (state.kind === 'anonymous') document.title = 'Sign in — DPWH document control';
    else if (state.kind === 'must-change') document.title = 'Choose a password — DPWH document control';
    // 'open' and 'signed-in' hand the title to the Shell, which names the tab.
  }, [state.kind]);

  const signOut = useCallback(async () => {
    /*
     * Swallowed deliberately, and with `catch` rather than `finally` — `finally`
     * runs the cleanup but still re-throws, and the caller discards the promise,
     * so a server that could not be reached became an unhandled rejection.
     *
     * There is nothing useful to tell someone who asked to sign out: whatever the
     * server said, this browser is done with the session, and the cookie it holds
     * either expires or is refused. Showing an error here would be an invitation
     * to stay signed in.
     */
    try {
      await authApi.logout();
    } catch {
      /* nothing to do about it, and nothing worth saying */
    }
    setState({ kind: 'anonymous' });
  }, []);

  switch (state.kind) {
    case 'asking':
      return <Loading />;

    case 'unreachable':
      return <Failed message={state.message} onRetry={() => void ask()} />;

    case 'anonymous':
      return <Login onSignedIn={() => void ask()} />;

    case 'must-change':
      return <ChangePassword required onDone={() => void ask()} />;

    case 'open':
      return <Shell />;

    case 'signed-in':
      return <Shell user={state.who.user} onSignOut={() => void signOut()} />;
  }
}
