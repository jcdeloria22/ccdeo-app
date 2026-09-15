/**
 * The bind guard.
 *
 * `AUTH_MODE=none` means every request is treated as the single seeded operator.
 * There is no password, no session, no check of any kind. That is acceptable for
 * one person on their own machine and catastrophic anywhere else, so the server
 * must refuse to start if it would be reachable from anywhere else.
 *
 *   > Startup must abort if BIND_HOST is anything other than 127.0.0.1 while
 *   > auth is off. This guard is not optional — it is what makes "no auth for
 *   > now" safe rather than merely convenient.
 *
 * Read the rule strictly. Only the literal `127.0.0.1` passes:
 *
 *  - `0.0.0.0` binds every interface. This is what Railway and most container
 *    platforms require, which is precisely why an unauthenticated build must not
 *    start there.
 *  - `localhost` is a name, not an address. What it resolves to depends on the
 *    host's resolver and hosts file, and it can resolve to a routable address.
 *    A guard that trusts a name is not a guard.
 *  - `::1` is loopback, but allowing one alias invites allowing the next. The
 *    cost of strictness is typing four numbers.
 *
 * Deploying this app publicly therefore requires authentication first. That is
 * the intended ordering, not an obstacle to work around.
 */
import { LOOPBACK, type Env } from './env';

export class UnsafeBindError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeBindError';
  }
}

/**
 * Throws if the configuration would expose an unauthenticated server.
 * Pure and synchronous, so it is callable before anything binds a socket.
 */
export function assertSafeBind(env: Pick<Env, 'AUTH_MODE' | 'BIND_HOST'>): void {
  if (env.AUTH_MODE !== 'none') return;
  if (env.BIND_HOST === LOOPBACK) return;

  throw new UnsafeBindError(
    [
      `Refusing to start: AUTH_MODE=none with BIND_HOST=${JSON.stringify(env.BIND_HOST)}.`,
      '',
      'With authentication off, every request is the seeded operator. Binding',
      `anything but ${LOOPBACK} would expose that to the network.`,
      '',
      'Either:',
      `  - set BIND_HOST=${LOOPBACK} (local single-operator use), or`,
      '  - enable authentication (AUTH_MODE=password) before binding elsewhere.',
      '',
      'Hosting this on Railway, or any platform that requires binding 0.0.0.0,',
      'means enabling authentication first. That ordering is deliberate.',
    ].join('\n'),
  );
}

/** True when this configuration is allowed to listen. Never narrows the rule. */
export function isSafeBind(env: Pick<Env, 'AUTH_MODE' | 'BIND_HOST'>): boolean {
  try {
    assertSafeBind(env);
    return true;
  } catch {
    return false;
  }
}
