/**
 * The role matrix, as data.
 *
 *   > Admin holds every capability, including finalize, sign, and void. Accepted
 *   > for now. The five-role matrix is still built as data with all policies
 *   > resolving permitted, so enabling real roles later is seed data, not a
 *   > rewrite.
 *
 * So: the shape is real, the values are permissive. `resolve()` returns permitted
 * for every pair while `AUTH_MODE=none`. `INTENDED` records what each pair becomes
 * once a second person has an account — it is not enforced yet, but it is written
 * down here rather than living in someone's head, and a test asserts every pair is
 * accounted for.
 *
 * ROLE NAMES CONFIRMED BY THE OWNER, 15 September 2026.
 *
 * The settled decisions fixed the matrix *shape* (five roles) and two rules —
 * only a Materials Engineer finalizes, only the designated approver moves Final
 * to Signed — but never enumerated the names. These five were proposed, put to
 * the owner, and confirmed, so they are now safe to reach seed data, API
 * contracts, and stored audit rows.
 *
 * That last one is why the confirmation mattered: `audit_events.actor_role` is
 * append-only and hash-chained, so a role name written into it cannot be renamed
 * later without breaking the chain. The names had to be right before the first
 * row was written under them, not after.
 */

export const ROLES = [
  'admin',
  'materials_engineer',
  'approver',
  'project_engineer',
  'viewer',
] as const;
export type Role = (typeof ROLES)[number];

export const CAPABILITIES = [
  'project.create',
  'project.edit',
  'document.create',
  'document.edit',
  'document.finalize',   // freezes content, records the hash
  'document.approve',    // Final -> Signed; the signature event
  'document.reject',     // requires a reason
  'document.void',       // requires a reason and an approver above the issuer
  'document.archive',
  'slot.waive',
  'recyclebin.purge',    // audited, typed confirmation naming the item
  'audit.read',
  'register.read',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * What the matrix becomes when roles are switched on. Recorded now so the change
 * is seed data later. Anything absent from a role's list is denied for that role.
 */
export const INTENDED: Record<Role, readonly Capability[]> = {
  admin: [...CAPABILITIES],
  materials_engineer: [
    'project.create', 'project.edit',
    'document.create', 'document.edit', 'document.finalize',
    'slot.waive', 'register.read', 'audit.read',
  ],
  approver: [
    'document.approve', 'document.reject', 'document.void',
    'register.read', 'audit.read',
  ],
  project_engineer: [
    'document.create', 'document.edit',
    'register.read', 'audit.read',
  ],
  viewer: ['register.read'],
} as const;

export interface PolicyDecision {
  readonly permitted: boolean;
  readonly reason: string;
}

/**
 * Resolve a capability for a role.
 *
 * While `AUTH_MODE=none` every pair resolves permitted — there is one operator and
 * they hold every capability. The decision still carries a reason so an audit
 * record can say *why* an act was allowed, not merely that it was.
 */
export function resolve(role: Role, capability: Capability, authMode: 'none' | 'password'): PolicyDecision {
  if (!ROLES.includes(role)) {
    return { permitted: false, reason: `unknown role: ${role}` };
  }
  if (!CAPABILITIES.includes(capability)) {
    return { permitted: false, reason: `unknown capability: ${capability}` };
  }

  if (authMode === 'none') {
    return { permitted: true, reason: 'single-operator mode: all policies permit' };
  }

  const permitted = INTENDED[role].includes(capability);
  return {
    permitted,
    reason: permitted
      ? `role ${role} holds ${capability}`
      : `role ${role} does not hold ${capability}`,
  };
}
