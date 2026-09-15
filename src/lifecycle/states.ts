/**
 * DC-07 — the lifecycle, as data.
 *
 *   > Draft → In Review → Final → Signed → Archived, with Superseded, Void
 *   > (document-level) and Waived (slot-level) as branches.
 *
 * Every rule the decisions fix is encoded in the transition table below rather
 * than scattered through handlers, so the whole machine can be read in one place
 * and tested exhaustively.
 *
 * NOTE on `In Review`: this project's decisions list it, so it is implemented.
 * The sibling `ccdeo-platform` skill drops the same state on the grounds that
 * "with one operator it records nothing true" — which applies here too while
 * AUTH_MODE=none. It is kept because it is in *this* product's settled lifecycle,
 * and because a transition through it is recorded honestly (the actor and the
 * role they acted under), rather than pretending a second person reviewed it.
 * Worth revisiting with the owner.
 */
import type { Capability, Role } from '../policy/roles';

export const STATES = ['Draft', 'In Review', 'Final', 'Signed', 'Archived', 'Superseded', 'Void'] as const;
export type DocumentState = (typeof STATES)[number];

export interface Transition {
  readonly from: DocumentState;
  readonly to: DocumentState;
  /** What the actor must be permitted to do. */
  readonly capability: Capability;
  /** A transition that destroys or rejects work must say why. */
  readonly requiresReason: boolean;
  /** Freezes the content and records its hash. */
  readonly freezesContent?: boolean;
  /** The signature event. */
  readonly isApproval?: boolean;
  /** Only these roles, regardless of the capability matrix. */
  readonly rolesAllowed?: readonly Role[];
  readonly note: string;
}

/**
 * The complete set. Anything not listed here cannot happen — the machine is
 * deny-by-default in the same way the HTTP guard is.
 */
export const TRANSITIONS: readonly Transition[] = [
  {
    from: 'Draft', to: 'In Review', capability: 'document.edit', requiresReason: false,
    note: 'submitted for review',
  },
  {
    from: 'In Review', to: 'Draft', capability: 'document.reject', requiresReason: true,
    note: 'sent back — rejection requires a reason',
  },
  {
    // Only a Materials Engineer finalizes. admin holds every capability while
    // AUTH_MODE=none, so this is expressed as a role restriction, not a capability.
    from: 'In Review', to: 'Final', capability: 'document.finalize', requiresReason: false,
    freezesContent: true, rolesAllowed: ['materials_engineer', 'admin'],
    note: 'finalizing freezes content and records its hash',
  },
  {
    from: 'Draft', to: 'Final', capability: 'document.finalize', requiresReason: false,
    freezesContent: true, rolesAllowed: ['materials_engineer', 'admin'],
    note: 'review is optional; finalizing still freezes content',
  },
  {
    // DC-08. Approval is impossible from any state but Final.
    from: 'Final', to: 'Signed', capability: 'document.approve', requiresReason: false,
    isApproval: true, rolesAllowed: ['approver', 'admin'],
    note: 'the signature event — bound to the frozen version’s content hash',
  },
  {
    from: 'Final', to: 'Draft', capability: 'document.reject', requiresReason: true,
    note: 'rejected back to draft — requires a reason',
  },
  {
    from: 'Signed', to: 'Archived', capability: 'document.archive', requiresReason: false,
    note: 'closed out',
  },
  {
    from: 'Signed', to: 'Superseded', capability: 'document.edit', requiresReason: true,
    note: 'a later version replaced this one',
  },
  // Void is reachable from any live state, and always needs a reason.
  ...(['Draft', 'In Review', 'Final', 'Signed'] as const).map((from) => ({
    from,
    to: 'Void' as const,
    capability: 'document.void' as const,
    requiresReason: true,
    rolesAllowed: ['approver', 'admin'] as const,
    note: 'voiding requires a reason and an approver above the issuer',
  })),
];

export function findTransition(from: DocumentState, to: DocumentState): Transition | null {
  return TRANSITIONS.find((t) => t.from === from && t.to === to) ?? null;
}

/** Terminal states: nothing leaves them. */
export const TERMINAL: readonly DocumentState[] = ['Archived', 'Superseded', 'Void'];

export function isTerminal(state: DocumentState): boolean {
  return TERMINAL.includes(state);
}

/** Readiness counts Signed only — never Final. */
export function countsAsDone(state: DocumentState): boolean {
  return state === 'Signed' || state === 'Archived';
}
