/**
 * DC-03 — the deny-by-default guard.
 *
 * A route is denied unless it says what capability it needs. Not "allowed unless
 * it says otherwise": a handler added in a hurry, or one whose decorator is lost
 * in a refactor, must fail closed. The cost is that every route declares itself;
 * that is the feature.
 *
 * Public routes exist (a health check has no actor), but they are opted in
 * explicitly with @Public() so that reading the handler tells you it is public.
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { resolve, type Capability, type Role } from './roles';
import type { Actor } from '../operator/operator';

export const CAPABILITY_KEY = 'policy:capability';
export const PUBLIC_KEY = 'policy:public';

/** Declare the capability a handler needs. Without one, the handler is denied. */
export const RequiresCapability = (capability: Capability) => SetMetadata(CAPABILITY_KEY, capability);

/** Opt a handler out of policy entirely. Deliberate, visible, and rare. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** What the guard needs from a request. Kept minimal so it is easy to test. */
export interface PolicyRequest {
  actor?: Actor;
  authMode?: 'none' | 'password';
}

@Injectable()
export class PolicyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const capability = this.reflector.getAllAndOverride<Capability | undefined>(CAPABILITY_KEY, targets);

    // The default. A handler that declares nothing gets nothing.
    if (!capability) {
      throw new ForbiddenException(
        'This endpoint declares no required capability, so it is denied. ' +
          'Add @RequiresCapability(...) or, if it is genuinely public, @Public().',
      );
    }

    const req = context.switchToHttp().getRequest<PolicyRequest>();
    const actor = req.actor;
    if (!actor) {
      throw new UnauthorizedException('No actor on the request — every act records who performed it.');
    }

    const decision = resolve(actor.role as Role, capability, req.authMode ?? actor.authMode);
    if (!decision.permitted) {
      throw new ForbiddenException(`${capability} denied: ${decision.reason}`);
    }
    return true;
  }
}
