import { describe, it, expect } from 'vitest';
import { loadEnv } from '../src/config/env';
import { seededOperator, currentActor, SINGLE_OPERATOR_ID, OperatorNotConfiguredError } from '../src/operator/operator';

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
    const on = loadEnv({ AUTH_MODE: 'password' } as NodeJS.ProcessEnv);
    expect(() => seededOperator(on)).toThrow(OperatorNotConfiguredError);
    expect(() => currentActor(on)).toThrow(OperatorNotConfiguredError);
  });
});
