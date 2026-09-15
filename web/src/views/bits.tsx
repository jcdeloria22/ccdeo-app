/**
 * The pieces every screen is built from.
 *
 * Two jobs here. The first is the states every view has to draw — loading,
 * failed, empty. A screen that renders nothing on a failed request looks exactly
 * like a screen with nothing to show, and on a register that difference is
 * "no outstanding work" against "you are not seeing your outstanding work".
 *
 * The second is making the app explain itself. This is a document-control system
 * with rules that refuse things, and someone meeting it for the first time should
 * learn the rule from the screen rather than from a 409. So: every action says
 * what it will do, every disabled control says why it is disabled, and every
 * refusal is shown in the words the server used.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../api';

export function Loading() {
  return <p className="q state">Loading…</p>;
}

export function Failed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="card state-bad" role="alert">
      <b>Could not load.</b>
      <div className="q">{message}</div>
      <button className="btn btn-secondary btn-sm" onClick={onRetry} style={{ marginTop: 12 }}>
        Try again
      </button>
    </div>
  );
}

export function Empty({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="card state">
      <b>{title}</b>
      {body && <div className="q">{body}</div>}
      {children && <div style={{ marginTop: 14 }}>{children}</div>}
    </div>
  );
}

/** One line under a heading saying what the screen is for. */
export function Explain({ children }: { children: ReactNode }) {
  return <p className="explain q">{children}</p>;
}

/**
 * What the server said when it refused.
 *
 * Shown verbatim. The messages are written to be read by whoever hit them — "No
 * transition Draft → Signed. The lifecycle is deny-by-default" teaches the rule,
 * where "Request failed" teaches nothing.
 */
export function Problem({ error, onDismiss }: { error: unknown; onDismiss?: () => void }) {
  if (!error) return null;
  const message = error instanceof ApiError ? error.message : (error as Error).message;
  return (
    <div className="problem" role="alert">
      <b>That did not work.</b>
      <div>{message}</div>
      {onDismiss && (
        <button className="btn btn-secondary btn-sm" onClick={onDismiss} style={{ marginTop: 10 }}>
          Dismiss
        </button>
      )}
    </div>
  );
}

/** A button that shows it is working and cannot be pressed twice. */
export function Action({
  label,
  busyLabel,
  onClick,
  kind = 'secondary',
  disabled,
  why,
}: {
  label: string;
  busyLabel?: string;
  onClick: () => Promise<void> | void;
  kind?: 'primary' | 'secondary' | 'brand';
  disabled?: boolean;
  /** Why it is disabled. Shown as a tooltip — a dead button with no explanation is a dead end. */
  why?: string;
}) {
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
  }, []);

  return (
    <button
      className={`btn btn-${kind} btn-sm`}
      disabled={busy || disabled}
      title={disabled ? why : undefined}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } finally {
          if (alive.current) setBusy(false);
        }
      }}
    >
      {busy ? (busyLabel ?? `${label}…`) : label}
    </button>
  );
}

/** A labelled input with room for the hint that stops someone guessing. */
export function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  id,
  type = 'text',
  autoFocus,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  id: string;
  type?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && <span className="q hint">{hint}</span>}
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/**
 * A panel that opens in place for a short form.
 *
 * Deliberately not a modal over a dimmed page: the thing being acted on stays
 * visible and readable, which matters when the form is "why are you waiving this
 * slot" and the answer depends on what the slot is.
 */
export function Panel({
  title,
  explain,
  onCancel,
  children,
}: {
  title: string;
  explain?: string;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <div className="panel">
      <div className="panel-head">
        <b>{title}</b>
        <button className="btn btn-secondary btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {explain && <p className="q explain">{explain}</p>}
      {children}
    </div>
  );
}

/** How long something has been where it is, from an ISO timestamp. */
export function days(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const d = Math.max(0, (Date.now() - then) / 86_400_000);
  if (d < 1 / 24) return 'under an hour';
  if (d < 1) {
    const h = Math.round(d * 24);
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  const n = Math.round(d);
  return `${n} day${n === 1 ? '' : 's'}`;
}

export function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
