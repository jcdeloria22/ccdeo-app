import { describe, it, expect } from 'vitest';
import { ROLES, CAPABILITIES, INTENDED, resolve } from '../src/policy/roles';

describe('the role matrix', () => {
  it('has five roles, as settled', () => {
    expect(ROLES).toHaveLength(5);
  });

  it('accounts for every role explicitly — no role falls through to a default', () => {
    for (const role of ROLES) expect(INTENDED[role]).toBeDefined();
  });

  it('only ever references known capabilities', () => {
    for (const role of ROLES) {
      for (const cap of INTENDED[role]) expect(CAPABILITIES).toContain(cap);
    }
  });

  it('permits everything while auth is off — the settled single-operator rule', () => {
    for (const role of ROLES) {
      for (const cap of CAPABILITIES) {
        expect(resolve(role, cap, 'none').permitted).toBe(true);
      }
    }
  });

  it('carries a reason, so an audit row can say why an act was allowed', () => {
    expect(resolve('admin', 'document.approve', 'none').reason).toMatch(/single-operator/);
  });

  it('admin holds every capability once roles are real', () => {
    for (const cap of CAPABILITIES) expect(resolve('admin', cap, 'password').permitted).toBe(true);
  });

  it('keeps the two rules the decisions actually fix', () => {
    // only a Materials Engineer finalizes
    expect(resolve('materials_engineer', 'document.finalize', 'password').permitted).toBe(true);
    expect(resolve('project_engineer', 'document.finalize', 'password').permitted).toBe(false);
    expect(resolve('viewer', 'document.finalize', 'password').permitted).toBe(false);
    // only the designated approver signs
    expect(resolve('approver', 'document.approve', 'password').permitted).toBe(true);
    expect(resolve('materials_engineer', 'document.approve', 'password').permitted).toBe(false);
  });

  it('denies unknown roles and capabilities rather than defaulting open', () => {
    expect(resolve('nobody' as never, 'register.read', 'none').permitted).toBe(false);
    expect(resolve('admin', 'document.destroy' as never, 'none').permitted).toBe(false);
  });
});
