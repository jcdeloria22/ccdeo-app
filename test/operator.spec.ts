import { describe, it, expect } from 'vitest';
import { loadEnv } from '../src/config/env';
import { seededOperator, currentActor, sessionActor, SINGLE_OPERATOR_ID, OperatorNotConfiguredError } from '../src/operator/operator';

const env = loadEnv({ AUTH_MODE: 'none', OPERATOR_NAME: 'Jayz', OPERATOR_EMAIL: 'jayz@example.com' } as NodeJS.ProcessEnv);

describe('the single-operator seam', () => {
  it('seeds an actor with a stable id', () => {
    expect(seededOperator(env).id).toBe(SINGLE_OPERATOR_ID);
    expect(seededOperator(env).name).toBe('Jayz');
  });

  it('records the role an act is performed under, not just who did it', () => {
    expect(seededOperator(env, 'approver').role).toBe('approver');
    expect(seededOperator(env, 'materials_engineer').role).toBe('materials_engineer');
  });

  it('records how the identity was established', () => {
    expect(seededOperator(env).authMode).toBe('none');
  });

  it('refuses to invent an actor once authentication is on', () => {
    // DATABASE_URL because password mode requires one — accounts live there.
    const on = loadEnv({
      AUTH_MODE: 'password',
      DATABASE_URL: 'postgres://u@h:5432/db',
    } as NodeJS.ProcessEnv);
    expect(() => seededOperator(on)).toThrow(OperatorNotConfiguredError);
    expect(() => currentActor(on)).toThrow(OperatorNotConfiguredError);
  });

  /**
   * With authentication on the actor comes from the session, and the role comes
   * with it. A caller cannot pass one — that would let a request choose its own
   * privileges.
   */
  it('builds an actor from a session, carrying the account’s own role', () => {
    const actor = sessionActor({
      userId: 'u-1',
      email: 'me@dpwh.gov.ph',
      name: 'Materials Engineer',
      role: 'materials_engineer',
    });
    expect(actor).toEqual({
      id: 'u-1',
      email: 'me@dpwh.gov.ph',
      name: 'Materials Engineer',
      role: 'materials_engineer',
      authMode: 'password',
    });
  });

  it('records that a session actor was established by password, for the audit', () => {
    expect(
      sessionActor({ userId: 'u-1', email: 'a@b.c', name: 'A', role: 'admin' }).authMode,
    ).toBe('password');
  });
});
