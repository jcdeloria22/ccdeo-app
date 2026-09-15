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
    // DATABASE_URL is supplied because password mode requires one — accounts
    // live in the database. The point of this test is the operator fields.
    expect(() =>
      loadEnv({ AUTH_MODE: 'password', DATABASE_URL: 'postgres://u@h:5432/db' } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it('rejects an out-of-range port', () => {
    expect(() => loadEnv({ ...base, PORT: '70000' } as NodeJS.ProcessEnv)).toThrow(ConfigError);
  });
});

/**
 * Authentication configuration.
 *
 * The secure-cookie default is the one worth pinning. `.optional().transform(v =>
 * v === 'true')` turns an unset variable into `false`, which made "secure unless
 * told otherwise" unreachable and would have shipped a session cookie without
 * Secure to a public host. Unset must stay undefined so the caller can default it.
 */
describe('AUTH_MODE=password', () => {
  const base = { AUTH_MODE: 'password', DATABASE_URL: 'postgres://u@h:5432/db' } as unknown as NodeJS.ProcessEnv;

  it('requires a database, because accounts live in one', () => {
    expect(() => loadEnv({ AUTH_MODE: 'password' } as unknown as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });

  it('leaves the secure-cookie setting unset rather than defaulting it to false', () => {
    expect(loadEnv(base).SESSION_COOKIE_SECURE).toBeUndefined();
  });

  it('reads the setting when it is given', () => {
    expect(loadEnv({ ...base, SESSION_COOKIE_SECURE: 'true' }).SESSION_COOKIE_SECURE).toBe(true);
    expect(loadEnv({ ...base, SESSION_COOKIE_SECURE: 'false' }).SESSION_COOKIE_SECURE).toBe(false);
  });

  /** A cookie without Secure in production is somebody else's session. */
  it('refuses an insecure session cookie in production', () => {
    expect(() =>
      loadEnv({ ...base, NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'false' } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/SESSION_COOKIE_SECURE/);
  });

  it('does not trust forwarded headers unless told to', () => {
    expect(loadEnv(base).TRUST_PROXY).toBe(false);
    expect(loadEnv({ ...base, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
  });
});
