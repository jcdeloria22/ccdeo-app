/**
 * Puts the actor on the request.
 *
 * This is the other half of the seam in `operator.ts`. `PolicyGuard` refuses any
 * request with no actor — "every act records who performed it" — so something has
 * to attach one, and that something is here rather than scattered through
 * controllers.
 *
 * Two modes:
 *
 *  - `AUTH_MODE=none` — the seeded operator, every time. Safe only because the
 *    bind guard refuses to listen anywhere but loopback in this mode.
 *  - `AUTH_MODE=password` — the session behind the cookie, or **no actor at all**.
 *
 * That second case is the important one. When there is no valid session this
 * middleware attaches nothing and calls `next()`. It does not throw. The guard
 * then refuses the request for want of an actor, which is the same deny-by-
 * default path every other unauthorised request takes — one place decides, and
 * a route marked `@Public()` still works without a session.
 */
import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import type { Env } from '../config/env';
import { ENV } from '../config/env.token';
import { currentActor, sessionActor } from './operator';
import type { PolicyRequest } from '../policy/policy.guard';
import { SessionsRepository } from '../auth/sessions.repository';
import { readCookie, SESSION_COOKIE } from '../auth/cookies';

@Injectable()
export class ActorMiddleware implements NestMiddleware {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly sessions: SessionsRepository,
  ) {}

  async use(req: Request & PolicyRequest, _res: Response, next: NextFunction): Promise<void> {
    req.authMode = this.env.AUTH_MODE;

    if (this.env.AUTH_MODE === 'none') {
      /*
       * Deliberately not swallowed. If the seeded operator cannot be established
       * the request must fail loudly: a handler that ran without one would write
       * audit rows naming nobody, which is worse than a 500.
       */
      req.actor = currentActor(this.env);
      next();
      return;
    }

    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (!token) {
      next();
      return;
    }

    /*
     * A database failure here must not authenticate anybody. It is caught so the
     * request continues without an actor and is refused by the guard, rather than
     * surfacing a connection error on every route including the login page.
     */
    let who = null;
    try {
      who = await this.sessions.resolve(token);
    } catch {
      who = null;
    }

    if (who) {
      req.actor = sessionActor(who);
      req.sessionId = who.sessionId;
      req.mustChangePassword = who.mustChangePassword;
    }
    next();
  }
}
