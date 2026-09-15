/**
 * DC-09 — readiness, as a pure function.
 *
 *   > Readiness counts Signed only, never Final. Approval debt — documents
 *   > sitting at Final — is displayed separately and never folded into a
 *   > completion percentage.
 *
 * The arithmetic lives here, away from the database, because the rule that makes
 * this number worth anything is a rule about what may be counted. A percentage
 * that quietly includes Final would make the backlog invisible at exactly the
 * moment it matters, and that is the thing the product exists to drain.
 *
 * No clock, no database, no I/O. The repository fetches rows; this decides what
 * they mean.
 */
import { countsAsDone, type DocumentState } from '../lifecycle/states';

export type SlotState = 'Pending' | 'Filled' | 'Waived';

/** What a single slot amounts to, once its documents are taken into account. */
export type SlotOutcome =
  /** a Signed (or Archived) document exists — this slot is closed out */
  | 'signed'
  /** a Final document is waiting for the approver — closed out it is NOT */
  | 'awaiting-approval'
  /** something exists and is moving, but is not Final yet */
  | 'in-progress'
  /** deliberately not required on this project, with a recorded reason */
  | 'waived'
  /** nothing live at all */
  | 'empty';

export interface SlotInput {
  readonly slotCode: string;
  readonly required: boolean;
  readonly slotState: SlotState;
  /** States of the live documents in this slot. Superseded and Void are excluded upstream. */
  readonly documentStates: readonly DocumentState[];
}

export interface SlotReadiness {
  readonly slotCode: string;
  readonly required: boolean;
  readonly outcome: SlotOutcome;
}

/**
 * How far along a state is. Only used to pick the most advanced live document in
 * a slot; it is deliberately not a claim that the lifecycle is linear — the
 * branches (Void, Superseded) never reach here.
 */
const PROGRESS: readonly DocumentState[] = ['Draft', 'In Review', 'Final', 'Signed', 'Archived'];

export function progressRank(state: DocumentState): number {
  const i = PROGRESS.indexOf(state);
  return i < 0 ? 0 : i + 1;
}

export function outcomeOf(slot: SlotInput): SlotOutcome {
  const best = slot.documentStates.reduce<DocumentState | null>(
    (acc, s) => (acc === null || progressRank(s) > progressRank(acc) ? s : acc),
    null,
  );

  // A signed document closes the slot out even if someone also waived it: the
  // work exists and was approved, and saying otherwise would understate reality.
  if (best !== null && countsAsDone(best)) return 'signed';
  if (slot.slotState === 'Waived') return 'waived';
  if (best === 'Final') return 'awaiting-approval';
  if (best !== null) return 'in-progress';
  return 'empty';
}

export interface Readiness {
  /** Required slots only — the denominator. */
  readonly requiredTotal: number;
  readonly signed: number;
  readonly waived: number;
  /** signed + waived. The numerator. */
  readonly closedOut: number;
  /** Approval debt. Reported, never counted. */
  readonly awaitingApproval: number;
  readonly inProgress: number;
  readonly empty: number;

  /** Optional slots are tracked but never move the percentage. */
  readonly optionalTotal: number;
  readonly optionalSigned: number;

  /** null when there is no required set — an empty set is not "complete". */
  readonly ratio: number | null;
  /** Whole percent for display. Never 100 unless everything required is closed out. */
  readonly percent: number | null;
  readonly complete: boolean;
}

export function summarise(slots: readonly SlotInput[]): Readiness {
  const outcomes = slots.map((s) => ({ ...s, outcome: outcomeOf(s) }));
  const required = outcomes.filter((s) => s.required);
  const optional = outcomes.filter((s) => !s.required);

  const count = (o: SlotOutcome) => required.filter((s) => s.outcome === o).length;

  const signed = count('signed');
  const waived = count('waived');
  const closedOut = signed + waived;
  const requiredTotal = required.length;

  const ratio = requiredTotal === 0 ? null : closedOut / requiredTotal;
  const complete = requiredTotal > 0 && closedOut === requiredTotal;

  /*
   * Rounding has to be one-directional here. 199 of 200 slots is 99.5%, and a
   * dashboard that rounds it to 100% tells someone the set is ready to submit
   * when it is not. Floor, and reserve 100 for actually finished.
   */
  const percent = ratio === null ? null : complete ? 100 : Math.min(99, Math.floor(ratio * 100));

  return {
    requiredTotal,
    signed,
    waived,
    closedOut,
    awaitingApproval: count('awaiting-approval'),
    inProgress: count('in-progress'),
    empty: count('empty'),
    optionalTotal: optional.length,
    optionalSigned: optional.filter((s) => s.outcome === 'signed').length,
    ratio,
    percent,
    complete,
  };
}

export function slotReadiness(slots: readonly SlotInput[]): SlotReadiness[] {
  return slots.map((s) => ({ slotCode: s.slotCode, required: s.required, outcome: outcomeOf(s) }));
}
