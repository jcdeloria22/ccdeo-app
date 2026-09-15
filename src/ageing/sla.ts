/**
 * DC-10 — the SLA clocks, as data.
 *
 *   > Age is measured per state, from the transition timestamp, and resets on
 *   > every transition. Never age-since-creation.
 *   > Every transition emits an audit event and starts or stops an SLA clock.
 *
 * So a clock belongs to a *state*, not to a document. Entering a state starts it;
 * leaving stops it. States with no entry here have no clock at all — Signed is
 * finished work and chasing it would be noise, and the terminal states are over.
 *
 * CONFIRMED BY THE OWNER, 15 September 2026 — both the day counts and the basis.
 *
 * These are not spec values and me-spec-sources does not reach them: no DPWH
 * issuance fixes how long a draft may sit. They are operational targets, and the
 * owner is the authority on them. They were proposed provisional, put to the
 * owner, and confirmed, so `provisional` is now false and the panel no longer
 * warns that it is running on unconfirmed numbers.
 *
 * Days are CALENDAR days, confirmed deliberately over working days. The trade is
 * known and accepted: a document finalized on a Friday is two days older by
 * Monday without anyone having failed to act on it. `basis` records that choice
 * per row rather than leaving it implicit, so a later switch to working days for
 * one state is a data change and not an archaeology exercise.
 *
 * Every row is still overridable — `AgeingRepository` takes an SLA array — so
 * changing a number remains a one-line change with no code that knows better.
 */
import type { DocumentState } from '../lifecycle/states';

export type DayBasis = 'calendar' | 'working';

export interface Sla {
  readonly state: DocumentState;
  /** Amber from here. */
  readonly warnAfterDays: number;
  /** Red from here. */
  readonly overdueAfterDays: number;
  /**
   * Calendar days count weekends and holidays; working days would not. Confirmed
   * as calendar for every row, and recorded per row so one state can change
   * without implying the others did.
   */
  readonly basis: DayBasis;
  /** True while a number is still waiting on the owner. All false since 15 Sep 2026. */
  readonly provisional: boolean;
  readonly note: string;
}

export const DEFAULT_SLAS: readonly Sla[] = [
  {
    state: 'Draft',
    warnAfterDays: 14,
    overdueAfterDays: 30,
    basis: 'calendar',
    provisional: false,
    note: 'a draft nobody has moved in a month is not work in progress, it is a gap',
  },
  {
    state: 'In Review',
    warnAfterDays: 5,
    overdueAfterDays: 10,
    basis: 'calendar',
    provisional: false,
    note: 'review is a short step; sitting here means it is queued, not being read',
  },
  {
    // The tightest clock on purpose. Approval debt is the thing the product exists
    // to drain, and a document at Final is finished work waiting on one signature.
    state: 'Final',
    warnAfterDays: 3,
    overdueAfterDays: 7,
    basis: 'calendar',
    provisional: false,
    note: 'approval debt — frozen, complete, and waiting on the approver alone',
  },
];

export function slaFor(state: DocumentState, slas: readonly Sla[] = DEFAULT_SLAS): Sla | null {
  return slas.find((s) => s.state === state) ?? null;
}

/** Is any clock running in this state at all? */
export function hasClock(state: DocumentState, slas: readonly Sla[] = DEFAULT_SLAS): boolean {
  return slaFor(state, slas) !== null;
}
