/**
 * An issued password gets you exactly one thing: the chance to replace it.
 *
 * When an administrator creates an account or resets a password they necessarily
 * know the credential they handed over. Until the person changes it, that
 * administrator can act as them — and an audit trail that names the wrong person
 * is worse than no audit trail, because it looks authoritative.
 *
 * So a session on an account flagged `must_change_password` is real enough to
 * sign in and change the password, and refused everywhere else. The refusal
 * carries a machine-readable code so the screen can route to the change form
 * rather than showing a dead end.
 *
 * Marked routes opt in with `@AllowsTemporaryPassword()`; the default is refusal,
 * matching the deny-by-default posture of `PolicyGuard`.
 */
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PolicyRequest } from '../policy/policy.guard';
import { PUBLIC_KEY } from '../policy/policy.guard';

export const TEMPORARY_PASSWORD_OK = 'auth:temporary-password-ok';

/** This handler may be used while the password still needs changing. */
export const AllowsTemporaryPassword = () => SetMetadata(TEMPORARY_PASSWORD_OK, true);

export class PasswordChangeRequiredError extends ForbiddenException {
  constructor() {
    super({
      statusCode: 403,
      code: 'password_change_required',
      message: 'Your password was issued by an administrator and must be changed before you can do anything else.',
    });
  }
}

@Injectable()
export class PasswordChangeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(TEMPORARY_PASSWORD_OK, targets)) return true;

    const req = context.switchToHttp().getRequest<PolicyRequest>();
    // No actor is not this guard's business; PolicyGuard refuses that.
    if (req.actor && req.mustChangePassword) throw new PasswordChangeRequiredError();

    return true;
  }
}
