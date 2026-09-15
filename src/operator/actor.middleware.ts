/**
 * Puts the actor on the request.
 *
 * This is the other half of the seam in `operator.ts`. `PolicyGuard` refuses any
 * request with no actor — "every act records who performed it" — so something has
 * to attach one, and that something is here rather than scattered through
 * controllers.
 *
 * While `AUTH_MODE=none` it is the seeded operator. When authentication lands,
 * this middleware reads a session instead and no controller changes.
 */
import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import type { Env } from '../config/env';
import { ENV } from '../config/env.token';
import { currentActor } from './operator';
import type { PolicyRequest } from '../policy/policy.guard';

@Injectable()
export class ActorMiddleware implements NestMiddleware {
  constructor(@Inject(ENV) private readonly env: Env) {}

  use(req: Request & PolicyRequest, _res: Response, next: NextFunction): void {
    /*
     * Deliberately not swallowed. If the actor cannot be established the request
     * must fail loudly: a handler that runs without one would write audit rows
     * that name nobody, which is worse than a 500.
     */
    req.actor = currentActor(this.env);
    req.authMode = this.env.AUTH_MODE;
    next();
  }
}
