/**
 * The shell.
 *
 * Reminders is the home tab, and that is a statement about the product rather
 * than a default: this exists to drain approval debt, so the first thing on
 * screen is what needs a person — not a completion percentage, which is the
 * number that feels like progress while nothing moves.
 *
 * The markup is the design system's own shell — `.shell > .rail + main >
 * .viewwrap > .view`, with `.navbtn` for the tabs. The first version of this file
 * invented its own `.shell` and `.rail`, which silently fought the system's rules
 * of the same name and produced a rail overlapping the content. The system
 * already had a rail; this uses it.
 *
 * Routing is the URL hash and a switch. A router library would add a dependency
 * and a concept for four tabs with no nested routes and one id; the hash also
 * survives a reload and can be linked to, which is all that was needed.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type SignedInUser } from './api';
import Reminders from './views/Reminders';
import Readiness from './views/Readiness';
import Register from './views/Register';
import Sets from './views/Sets';
import Builder from './views/Builder';
import Reviewer from './views/Reviewer';
import Workflow from './views/Workflow';
import Audit from './views/Audit';

export type TabKey =
  | 'reminders'
  | 'readiness'
  | 'register'
  | 'builder'
  | 'sets'
  | 'workflow'
  | 'me'
  | 'pe'
  | 'audit';

interface Tab {
  key: TabKey;
  label: string;
}

/** Order is the order of the day: what needs you, then where things stand, then the record. */
const TABS: Tab[] = [
  { key: 'reminders', label: 'Reminders' },
  { key: 'readiness', label: 'Readiness' },
  { key: 'register', label: 'Register' },
  { key: 'builder', label: 'Document Builder' },
  { key: 'sets', label: 'Document sets' },
  { key: 'workflow', label: 'ME Workflow' },
  { key: 'me', label: 'ME Reviewer' },
  { key: 'pe', label: 'PE Reviewer' },
  { key: 'audit', label: 'Audit' },
];

const KEYS = new Set<string>(TABS.map((t) => t.key));

/** `#/register/<id>` — the only route that carries anything. */
function parseHash(hash: string): { tab: TabKey; projectId: string | null } {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const tab = parts[0] && KEYS.has(parts[0]) ? (parts[0] as TabKey) : 'reminders';
  return { tab, projectId: tab === 'register' && parts[1] ? parts[1] : null };
}

/**
 * `user` is absent on a single-operator build, where there is nobody to name and
 * nothing to sign out of. The rail says which arrangement is in force either way
 * — "who am I acting as" is not a question this app should leave unanswered.
 */
export interface ShellProps {
  user?: SignedInUser;
  onSignOut?: () => void;
}

export default function Shell({ user, onSignOut }: ShellProps = {}) {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  /*
   * The badge is fetched by the shell, not handed up from the Reminders view.
   * It has to be right on every tab — the whole point of a count on a nav item is
   * that it tells you something while you are looking somewhere else.
   */
  const refreshUnread = useCallback(async () => {
    try {
      setUnread((await api.counts()).unread);
    } catch {
      /* the nav badge is not worth an error state; the tab itself will report it */
    }
  }, []);

  useEffect(() => {
    void refreshUnread();
  }, [refreshUnread, route.tab]);

  useEffect(() => {
    const tab = TABS.find((t) => t.key === route.tab);
    document.title = `${unread > 0 ? `(${unread}) ` : ''}${tab?.label ?? 'Reminders'} — DPWH document control`;
  }, [route.tab, unread]);

  return (
    <div className="shell">
      <nav className="rail" aria-label="Sections">
        <div className="rail-brand">
          <div className="tx">
            <div className="nm">DPWH</div>
            <div className="sub q">Materials document control</div>
          </div>
          <div className="cube" aria-hidden="true">
            DC
          </div>
        </div>

        <div className="rail-scroll">
          <div className="grp-h">Sections</div>
          {TABS.map((t) => (
            <button
              key={t.key}
              className="navbtn"
              aria-current={route.tab === t.key ? 'page' : undefined}
              onClick={() => {
                window.location.hash = `#/${t.key}`;
              }}
            >
              <span className="lb">{t.label}</span>
              {t.key === 'reminders' && unread > 0 && (
                <span className="badge badge-overdue" aria-label={`${unread} unread`}>
                  {unread}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="rail-f">
          {user ? (
            <>
              <b>{user.name}</b>
              <span className="who q">{user.email}</span>
              <span className="who q">acting as {user.role.replace(/_/g, ' ')}</span>
              {onSignOut && (
                <button className="btn btn-secondary btn-block signout" onClick={onSignOut}>
                  Sign out
                </button>
              )}
            </>
          ) : (
            <>
              <b>Single operator</b>
              Auth is off, so the server refuses to bind anything but loopback.
            </>
          )}
        </div>
      </nav>

      <main>
        <div className="viewwrap">
          {route.tab === 'reminders' && <Reminders onCountsChanged={setUnread} />}
          {route.tab === 'readiness' && <Readiness />}
          {route.tab === 'register' && <Register projectId={route.projectId} />}
          {route.tab === 'builder' && <Builder />}
          {route.tab === 'sets' && <Sets />}
          {route.tab === 'workflow' && <Workflow />}
          {route.tab === 'me' && <Reviewer bank="me" />}
          {route.tab === 'pe' && <Reviewer bank="pe" />}
          {route.tab === 'audit' && <Audit />}
        </div>
      </main>
    </div>
  );
}
