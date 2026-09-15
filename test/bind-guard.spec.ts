/**
 * The guard is the reason an unauthenticated build is safe, so it is tested
 * harder than anything else here — including a test that actually starts the
 * server and asserts it refuses to open a socket.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { assertSafeBind, isSafeBind, UnsafeBindError } from '../src/config/bind-guard';
import { LOOPBACK } from '../src/config/env';

const withAuthOff = (host: string) => ({ AUTH_MODE: 'none' as const, BIND_HOST: host });

describe('assertSafeBind', () => {
  it('permits loopback while auth is off', () => {
    expect(() => assertSafeBind(withAuthOff(LOOPBACK))).not.toThrow();
  });

  // Each of these is a real way someone ends up exposed.
  const unsafe = [
    ['0.0.0.0', 'every interface — what Railway and most containers require'],
    ['::', 'every interface, IPv6'],
    ['localhost', 'a name, not an address; resolution is not ours to trust'],
    ['::1', 'loopback, but an alias — allowing one invites the next'],
    ['LOCALHOST', 'case variation'],
    ['127.0.0.2', 'loopback range, but not the literal address'],
    ['0.0.0.0 ', 'trailing whitespace'],
    ['192.168.1.10', 'a LAN address'],
    ['', 'empty'],
  ] as const;

  for (const [host, why] of unsafe) {
    it(`refuses ${JSON.stringify(host)} — ${why}`, () => {
      expect(() => assertSafeBind(withAuthOff(host))).toThrow(UnsafeBindError);
    });
  }

  it('says what to do about it', () => {
    try {
      assertSafeBind(withAuthOff('0.0.0.0'));
      throw new Error('should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('AUTH_MODE=none');
      expect(msg).toContain('0.0.0.0');
      expect(msg).toContain(LOOPBACK);
      expect(msg).toContain('Railway');
    }
  });

  it('does not constrain the bind host once authentication is on', () => {
    expect(() => assertSafeBind({ AUTH_MODE: 'password', BIND_HOST: '0.0.0.0' })).not.toThrow();
  });

  it('isSafeBind agrees with assertSafeBind', () => {
    expect(isSafeBind(withAuthOff(LOOPBACK))).toBe(true);
    expect(isSafeBind(withAuthOff('0.0.0.0'))).toBe(false);
  });
});

/**
 * The unit tests above prove the function. This proves the *application* — that
 * the guard sits before anything binds, and that a misconfigured process exits
 * non-zero instead of quietly serving.
 */
describe('the process itself', () => {
  const run = (env: Record<string, string>) =>
    spawnSync(process.execPath, ['-r', 'ts-node/register', path.join(__dirname, '..', 'src', 'main.ts')], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        AUTH_MODE: 'none',
        OPERATOR_NAME: 'Test Operator',
        OPERATOR_EMAIL: 'test@example.com',
        TS_NODE_TRANSPILE_ONLY: 'true',
        ...env,
      },
      encoding: 'utf8',
      timeout: 60_000,
    });

  it('exits non-zero and never listens when asked to bind 0.0.0.0 with auth off', () => {
    const r = run({ BIND_HOST: '0.0.0.0', PORT: '39997' });
    expect(r.status).not.toBe(0);
    expect(`${r.stderr}${r.stdout}`).toContain('Refusing to start');
    expect(`${r.stderr}${r.stdout}`).not.toContain('listening on');
  }, 70_000);

  it('refuses a missing operator identity rather than writing anonymous audit rows', () => {
    const r = run({ BIND_HOST: '127.0.0.1', PORT: '39998', OPERATOR_NAME: '', OPERATOR_EMAIL: '' });
    expect(r.status).not.toBe(0);
    expect(`${r.stderr}${r.stdout}`).toContain('Invalid configuration');
  }, 70_000);
});

/**
 * Proving refusal is only half of it. A guard that refused everything would pass
 * every test above, so this asserts the safe configuration genuinely listens.
 */
describe('the safe configuration', () => {
  it('starts and listens on loopback', async () => {
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, ['-r', 'ts-node/register', path.join(__dirname, '..', 'src', 'main.ts')], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        AUTH_MODE: 'none',
        BIND_HOST: '127.0.0.1',
        PORT: '39991',
        OPERATOR_NAME: 'Test Operator',
        OPERATOR_EMAIL: 'test@example.com',
        TS_NODE_TRANSPILE_ONLY: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const listening = await new Promise<string>((resolve, reject) => {
      let buf = '';
      const done = (v: string) => { clearTimeout(timer); resolve(v); };
      const timer = setTimeout(() => reject(new Error(`never listened; saw:\n${buf}`)), 45_000);
      child.stdout.on('data', (d) => { buf += d; if (buf.includes('listening on')) done(buf); });
      child.stderr.on('data', (d) => { buf += d; });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`exited ${code}:\n${buf}`)); });
    }).finally(() => { child.kill('SIGKILL'); });

    expect(listening).toContain('listening on http://127.0.0.1:39991');
    expect(listening).toContain('auth      : none');
    expect(listening).toContain('Test Operator');
  }, 60_000);
});
