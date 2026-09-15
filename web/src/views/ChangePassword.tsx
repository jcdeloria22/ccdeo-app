/**
 * Replacing a password.
 *
 * Shown in two situations, and it says which one it is in. After an
 * administrator issues a password the account can do nothing else until this is
 * done — the admin knows that credential, and an audit trail that might name the
 * wrong person is worse than none. The same form is reachable later by choice.
 *
 * The rules are stated before the person types rather than after they fail. The
 * server is the authority on them and refuses with the full list of problems at
 * once; this repeats the important one up front so the first attempt usually
 * works.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { authApi, ApiError } from '../api';

const MIN = 12;

export default function ChangePassword({
  required,
  onDone,
  onCancel,
}: {
  /** True when an administrator issued the current password. */
  required: boolean;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  /* Checked here only to save a round trip; the server decides. */
  const mismatch = again.length > 0 && next !== again;
  const tooShort = next.length > 0 && next.length < MIN;
  const same = next.length > 0 && next === current;
  const ready = current.length > 0 && next.length >= MIN && next === again && !same;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !ready) return;

    setError(null);
    setBusy(true);
    try {
      await authApi.changePassword(current, next);
      setCurrent('');
      setNext('');
      setAgain('');
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <form className="card signin-card" onSubmit={submit}>
        <h1>{required ? 'Choose your own password' : 'Change your password'}</h1>

        {required ? (
          <p className="q signin-intro">
            The password you signed in with was issued by an administrator, who therefore knows it. Until you replace it
            you cannot do anything else — otherwise the record could name you for something you did not do.
          </p>
        ) : (
          <p className="q signin-intro">
            Changing this ends every other session on your account, including any you have forgotten about.
          </p>
        )}

        {error && (
          <div className="card signin-error" role="alert">
            {error}
          </div>
        )}

        <div className="field">
          <label htmlFor="cp-current">Current password</label>
          <input
            id="cp-current"
            ref={first}
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="field">
          <label htmlFor="cp-next">New password</label>
          <input
            id="cp-next"
            className="input"
            type="password"
            autoComplete="new-password"
            required
            value={next}
            onChange={(e) => setNext(e.target.value)}
            disabled={busy}
          />
          <span className="q hint">
            At least {MIN} characters. Length is what matters — a phrase you can remember beats a short one with
            symbols in it, and nothing here demands a capital letter or a digit.
          </span>
        </div>

        <div className="field">
          <label htmlFor="cp-again">New password again</label>
          <input
            id="cp-again"
            className="input"
            type="password"
            autoComplete="new-password"
            required
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            disabled={busy}
          />
        </div>

        {tooShort && <p className="q signin-hint">{MIN - next.length} more character(s) needed.</p>}
        {mismatch && <p className="q signin-hint">The two new passwords do not match yet.</p>}
        {same && <p className="q signin-hint">The new password has to be different from the current one.</p>}

        <button className="btn btn-primary btn-block" type="submit" disabled={busy || !ready}>
          {busy ? 'Saving…' : 'Change password'}
        </button>

        {onCancel && !required && (
          <button className="btn btn-secondary btn-block" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </form>
    </div>
  );
}
