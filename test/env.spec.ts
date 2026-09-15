import { describe, it, expect } from 'vitest';
import { loadEnv, ConfigError, LOOPBACK } from '../src/config/env';

const base = { AUTH_MODE: 'none', OPERATOR_NAME: 'Jayz', OPERATOR_EMAIL: 'jayz@example.com' };

describe('loadEnv', () => {
  it('defaults to loopback and single-operator mode', () => {
    const env = loadEnv({ ...base } as NodeJS.ProcessEnv);
    expect(env.BIND_HOST).toBe(LOOPBACK);
    expect(env.AUTH_MODE).toBe('none');
    expect(env.PORT).toBe(3000);
  });

  it('requires an operator identity when auth is off', () => {
    expect(() => loadEnv({ AUTH_MODE: 'none' } as NodeJS.ProcessEnv)).toThrow(ConfigError);
  });

  it('reports every problem at once, not just the first', () => {
    try {
      loadEnv({ AUTH_MODE: 'none', PORT: 'not-a-port' } as unknown as NodeJS.ProcessEnv);
      throw new Error('should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('OPERATOR_NAME');
      expect(msg).toContain('OPERATOR_EMAIL');
      expect(msg).toContain('PORT');
    }
  });

  it('rejects a malformed operator email', () => {
    expect(() => loadEnv({ ...base, OPERATOR_EMAIL: 'not-an-email' } as NodeJS.ProcessEnv)).toThrow(ConfigError);
  });

  it('does not require an operator identity once auth is on', () => {
    expect(() => loadEnv({ AUTH_MODE: 'password' } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('rejects an out-of-range port', () => {
    expect(() => loadEnv({ ...base, PORT: '70000' } as NodeJS.ProcessEnv)).toThrow(ConfigError);
  });
});
