/**
 * The single-operator seam.
 *
 *   > `AUTH_MODE=none`, a single Admin operator seeded from OPERATOR_NAME /
 *   > OPERATOR_EMAIL.
 *
 * Everything that writes asks for the *actor* here rather than assuming one. That
 * is the seam: when authentication arrives, `currentActor()` starts reading a
 * session instead of the config and nothing downstream changes.
 *
 *   > Every write records an actor, even while the actor is always the one
 *   > operator. … while one operator holds every role, the record still stores
 *   > which role each act was performed under.
 *
 * So an Actor carries the role the act was performed under, not merely who did it.
 */
import type { Env } from '../config/env';
import type { Role } from '../policy/roles';

export interface Actor {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  /** The role this particular act is performed under. */
  readonly role: Role;
  /** How the identity was established — recorded so audit can show it. */
  readonly authMode: Env['AUTH_MODE'];
}

/** Stable id for the seeded operator. Deterministic, so audit rows join. */
export const SINGLE_OPERATOR_ID = 'operator:single';

export class OperatorNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperatorNotConfiguredError';
  }
}

/**
 * The seeded operator. `role` defaults to admin because that is what the settled
 * decision grants, but callers name the role the act is performed under so the
 * audit record is truthful once roles are real.
 */
export function seededOperator(env: Env, role: Role = 'admin'): Actor {
  if (env.AUTH_MODE !== 'none') {
    throw new OperatorNotConfiguredError(
      'seededOperator() is only valid while AUTH_MODE=none; with authentication on, the actor comes from the session',
    );
  }
  if (!env.OPERATOR_NAME || !env.OPERATOR_EMAIL) {
    // loadEnv() already enforces this; belt and braces, because an actor with no
    // identity would silently poison every audit row it touches.
    throw new OperatorNotConfiguredError('OPERATOR_NAME and OPERATOR_EMAIL are required when AUTH_MODE=none');
  }
  return {
    id: SINGLE_OPERATOR_ID,
    name: env.OPERATOR_NAME,
    email: env.OPERATOR_EMAIL,
    role,
    authMode: env.AUTH_MODE,
  };
}

/**
 * Who a signed-in session belongs to, as an Actor.
 *
 * The role comes from the account, not from the caller: with real accounts the
 * role someone acts under is a property of the account, and letting a caller
 * pass one would mean a request could choose its own privileges.
 */
export function sessionActor(session: {
  userId: string;
  email: string;
  name: string;
  role: Role;
}): Actor {
  return {
    id: session.userId,
    name: session.name,
    email: session.email,
    role: session.role,
    authMode: 'password',
  };
}

/**
 * The actor for the current request.
 *
 * While `AUTH_MODE=none` this is the seeded operator, and the bind guard keeps
 * that arrangement on loopback. With authentication on there is no actor to
 * derive from configuration — it comes from the session, which is asynchronous
 * and lives in `ActorMiddleware`. Throwing here is therefore correct rather than
 * unfinished: anything calling this under `password` has skipped the session.
 */
export function currentActor(env: Env, role: Role = 'admin'): Actor {
  if (env.AUTH_MODE === 'none') return seededOperator(env, role);
  throw new OperatorNotConfiguredError(
    'AUTH_MODE=password: the actor comes from the session, not from configuration — use ActorMiddleware',
  );
}
