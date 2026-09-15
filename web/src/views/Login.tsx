/**
 * Signing in.
 *
 * The screen deliberately says very little. The server answers every failed
 * attempt identically — wrong password, no such account, disabled, locked all
 * return the same thing — and this shows exactly what it was told rather than
 * trying to be more helpful. Guessing at "that account is locked" here would
 * reintroduce, in the browser, the disclosure the API is careful to avoid.
 *
 * There is no "forgot password" link because there is no email to send one from.
 * An administrator issues a new password with `npm run user:create`-style tooling
 * and the account is then required to change it; the screen says so instead of
 * offering a route that does not exist.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { authApi, ApiError } from '../api';

export default function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;

    setError(null);
    setBusy(true);
    try {
      await authApi.login(email.trim(), password);
      /*
       * The password is dropped from state before anything else happens. It is
       * of no further use, and React keeps state alive for as long as the
       * component is mounted.
       */
      setPassword('');
      onSignedIn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
      setPassword('');
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <form className="card signin-card" onSubmit={submit}>
        <div className="signin-brand">
          <div className="cube" aria-hidden="true">
            DC
          </div>
          <div>
            <h1>DPWH</h1>
            <p className="q">Materials document control</p>
          </div>
        </div>

        <p className="q signin-intro">Sign in to continue. Every act here is recorded against the account that performs it.</p>

        {error && (
          <div className="card signin-error" role="alert">
            {error}
          </div>
        )}

        <div className="field">
          <label htmlFor="signin-email">Email</label>
          <input
            id="signin-email"
            ref={emailRef}
            className="input"
            type="email"
            name="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="field">
          <label htmlFor="signin-password">Password</label>
          <input
            id="signin-password"
            className="input"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </div>

        <button className="btn btn-primary btn-block" type="submit" disabled={busy || !email.trim() || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="q signin-note">
          No account, or locked out? An administrator issues these — there is no self-service reset, because there is no
          mail server to send one from.
        </p>
      </form>
    </div>
  );
}
