/**
 * DC-03 — proving the guard fails closed.
 *
 * The important test here is the boring one: a handler that declares nothing is
 * denied. Everything else follows from that.
 */
import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PolicyGuard, CAPABILITY_KEY, PUBLIC_KEY, type PolicyRequest } from '../src/policy/policy.guard';
import type { Actor } from '../src/operator/operator';
import type { Role } from '../src/policy/roles';

const actor = (role: Role, authMode: 'none' | 'password' = 'none'): Actor => ({
  id: 'operator:single',
  name: 'Jayz',
  email: 'jayz@example.com',
  role,
  authMode,
});

/** A fake ExecutionContext carrying whatever metadata the case needs. */
function ctx(meta: Record<string, unknown>, req: PolicyRequest) {
  const handler = () => undefined;
  const cls = class {};
  // Reflector reads metadata off the handler/class; set it where it looks.
  for (const [k, v] of Object.entries(meta)) Reflect.defineMetadata(k, v, handler);
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => req }),
  } as never;
}

const guard = new PolicyGuard(new Reflector());

describe('the deny-by-default guard', () => {
  it('DENIES a handler that declares no capability', () => {
    expect(() => guard.canActivate(ctx({}, { actor: actor('admin') }))).toThrow(ForbiddenException);
  });

  it('says how to fix an undeclared handler', () => {
    try {
      guard.canActivate(ctx({}, { actor: actor('admin') }));
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('@RequiresCapability');
      expect((e as Error).message).toContain('@Public()');
    }
  });

  it('allows an explicitly public handler with no actor at all', () => {
    expect(guard.canActivate(ctx({ [PUBLIC_KEY]: true }, {}))).toBe(true);
  });

  it('refuses a declared handler with no actor', () => {
    expect(() => guard.canActivate(ctx({ [CAPABILITY_KEY]: 'register.read' }, {}))).toThrow(UnauthorizedException);
  });

  it('allows a declared capability in single-operator mode', () => {
    expect(guard.canActivate(ctx({ [CAPABILITY_KEY]: 'document.approve' }, { actor: actor('admin') }))).toBe(true);
  });

  it('enforces the role matrix once authentication is on', () => {
    const req = { actor: actor('viewer', 'password'), authMode: 'password' as const };
    expect(() => guard.canActivate(ctx({ [CAPABILITY_KEY]: 'document.finalize' }, req))).toThrow(ForbiddenException);
  });

  it('keeps the settled rule: only a Materials Engineer finalizes', () => {
    const me = { actor: actor('materials_engineer', 'password'), authMode: 'password' as const };
    const pe = { actor: actor('project_engineer', 'password'), authMode: 'password' as const };
    expect(guard.canActivate(ctx({ [CAPABILITY_KEY]: 'document.finalize' }, me))).toBe(true);
    expect(() => guard.canActivate(ctx({ [CAPABILITY_KEY]: 'document.finalize' }, pe))).toThrow(ForbiddenException);
  });

  it('keeps the settled rule: only the approver signs', () => {
    const ap = { actor: actor('approver', 'password'), authMode: 'password' as const };
    const me = { actor: actor('materials_engineer', 'password'), authMode: 'password' as const };
    expect(guard.canActivate(ctx({ [CAPABILITY_KEY]: 'document.approve' }, ap))).toBe(true);
    expect(() => guard.canActivate(ctx({ [CAPABILITY_KEY]: 'document.approve' }, me))).toThrow(ForbiddenException);
  });

  it('denies an unknown capability rather than waving it through', () => {
    const req = { actor: actor('admin', 'password'), authMode: 'password' as const };
    expect(() => guard.canActivate(ctx({ [CAPABILITY_KEY]: 'document.destroy' }, req))).toThrow(ForbiddenException);
  });

  it('explains the denial', () => {
    const req = { actor: actor('viewer', 'password'), authMode: 'password' as const };
    try {
      guard.canActivate(ctx({ [CAPABILITY_KEY]: 'recyclebin.purge' }, req));
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('recyclebin.purge');
      expect((e as Error).message).toContain('viewer');
    }
  });
});
