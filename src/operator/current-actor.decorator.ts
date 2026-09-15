/**
 * The actor on the request, as a parameter.
 *
 * `ActorMiddleware` attaches it and `PolicyGuard` refuses any request without
 * one, so by the time a handler runs it is always present — the cast is
 * contained here rather than repeated in every controller.
 */
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Actor } from './operator';
import type { PolicyRequest } from '../policy/policy.guard';

export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<PolicyRequest>();
  return req.actor as Actor;
});
