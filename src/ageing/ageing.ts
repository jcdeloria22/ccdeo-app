/**
 * DC-10 — ageing and the reminder engine, as pure functions.
 *
 * `now` is a parameter everywhere. Nothing in here reads the clock, so the
 * behaviour at a boundary is something a test can state outright rather than
 * something that depends on when the suite happens to run.
 */
import type { DocumentState } from '../lifecycle/states';
import { isTerminal } from '../lifecycle/states';
import { DEFAULT_SLAS, slaFor, type Sla } from './sla';

export type Severity = 'none' | 'ok' | 'warning' | 'overdue';

const MS_PER_DAY = 86_400_000;

/**
 * Age in days, fractional.
 *
 * A timestamp in the future means a clock skew or a bad row, not a negative age.
 * Clamping to zero keeps one bad row from reading as "fine, minus three days" and
 * sorting to the top of a panel meant to show the oldest work.
 */
export function ageInDays(since: Date, now: Date): number {
  return Math.max(0, (now.getTime() - since.getTime()) / MS_PER_DAY);
}

export interface Aged {
  readonly state: DocumentState;
  readonly stateSince: Date;
  readonly ageDays: number;
  readonly severity: Severity;
  /** Days until the next threshold; null when no clock runs, negative never. */
  readonly daysUntilWarning: number | null;
  readonly daysUntilOverdue: number | null;
  readonly sla: Sla | null;
}

export function assess(
  state: DocumentState,
  stateSince: Date,
  now: Date,
  slas: readonly Sla[] = DEFAULT_SLAS,
): Aged {
  const ageDays = ageInDays(stateSince, now);
  const sla = isTerminal(state) ? null : slaFor(state, slas);

  if (!sla) {
    return { state, stateSince, ageDays, severity: 'none', daysUntilWarning: null, daysUntilOverdue: null, sla: null };
  }

  const severity: Severity =
    ageDays >= sla.overdueAfterDays ? 'overdue' : ageDays >= sla.warnAfterDays ? 'warning' : 'ok';

  return {
    state,
    stateSince,
    ageDays,
    severity,
    daysUntilWarning: Math.max(0, sla.warnAfterDays - ageDays),
    daysUntilOverdue: Math.max(0, sla.overdueAfterDays - ageDays),
    sla,
  };
}

export type ReminderLevel = 'warning' | 'overdue';

export interface AgeingItem {
  readonly documentId: string;
  readonly projectId: string;
  readonly contractId: string;
  readonly slotCode: string;
  readonly title: string;
  readonly state: DocumentState;
  readonly stateSince: Date;
}

export interface AgedItem extends AgeingItem {
  readonly aged: Aged;
}

/** Oldest first — a panel exists to show what has waited longest. */
export function ageAll(items: readonly AgeingItem[], now: Date, slas: readonly Sla[] = DEFAULT_SLAS): AgedItem[] {
  return items
    .map((i) => ({ ...i, aged: assess(i.state, i.stateSince, now, slas) }))
    .sort((a, b) => b.aged.ageDays - a.aged.ageDays);
}

export interface Reminder {
  readonly documentId: string;
  readonly state: DocumentState;
  /**
   * Part of the identity of the reminder, not decoration. A document that goes
   * back to Draft and returns to Final has a new clock and deserves a new
   * reminder; one that has merely sat still does not.
   */
  readonly stateSince: Date;
  readonly level: ReminderLevel;
  readonly ageDays: number;
  readonly reason: string;
}

/**
 * What is due right now, before deduplication.
 *
 * Only the highest level that applies is returned for a document: something that
 * is overdue does not also need its warning sent. The repository is what stops a
 * reminder being sent twice; this function only says what is true.
 */
export function remindersDue(
  items: readonly AgeingItem[],
  now: Date,
  slas: readonly Sla[] = DEFAULT_SLAS,
): Reminder[] {
  const out: Reminder[] = [];
  for (const item of ageAll(items, now, slas)) {
    const { aged } = item;
    if (aged.severity !== 'warning' && aged.severity !== 'overdue') continue;
    out.push({
      documentId: item.documentId,
      state: item.state,
      stateSince: item.stateSince,
      level: aged.severity,
      ageDays: aged.ageDays,
      reason: `${item.state} for ${aged.ageDays.toFixed(1)} days — ${aged.sla!.note}`,
    });
  }
  return out;
}

export interface AgeingSummary {
  readonly ok: number;
  readonly warning: number;
  readonly overdue: number;
  /** Documents with no clock running — finished or terminal. */
  readonly untracked: number;
  /** The oldest tracked item, or null when nothing is being tracked. */
  readonly oldest: AgedItem | null;
}

export function summariseAgeing(items: readonly AgedItem[]): AgeingSummary {
  const count = (s: Severity) => items.filter((i) => i.aged.severity === s).length;
  const tracked = items.filter((i) => i.aged.severity !== 'none');
  return {
    ok: count('ok'),
    warning: count('warning'),
    overdue: count('overdue'),
    untracked: count('none'),
    oldest: tracked.length ? tracked.reduce((a, b) => (b.aged.ageDays > a.aged.ageDays ? b : a)) : null,
  };
}
