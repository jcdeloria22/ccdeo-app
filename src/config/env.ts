/**
 * Environment configuration, parsed and validated once at startup.
 *
 * Nothing else in the application reads `process.env`. That is deliberate: the
 * bind guard is only trustworthy if there is exactly one place the bind host can
 * come from.
 */
import { z } from 'zod';

export const AUTH_MODES = ['none', 'password'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

/** The only host that may be bound while authentication is off. */
export const LOOPBACK = '127.0.0.1';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /**
   * `none` means every request is the single seeded operator. It is safe only
   * because the bind guard refuses to expose such a server beyond loopback.
   */
  AUTH_MODE: z.enum(AUTH_MODES).default('none'),

  BIND_HOST: z.string().min(1).default(LOOPBACK),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  /** Identity of the single operator while AUTH_MODE=none. */
  OPERATOR_NAME: z.string().min(1).optional(),
  OPERATOR_EMAIL: z.string().email().optional(),

  /** Required from DC-02 onwards; absent is fine until then. */
  DATABASE_URL: z.string().url().optional(),

  /**
   * Where the local blob store writes.
   *
   * Development only. The decisions are explicit that Railway's filesystem is
   * ephemeral and must never hold blobs — when storage moves to R2 this is
   * replaced by that binding, not joined by it.
   */
  STORAGE_DIR: z.string().min(1).optional(),

  /**
   * Whether the session cookie is marked `Secure`.
   *
   * Defaults on in production, because a session cookie that can travel over
   * plain HTTP is a session that can be stolen in transit. It is a setting only
   * so that a local build over http://127.0.0.1 can still sign in; anywhere the
   * app is reachable by others this must stay on.
   */
  SESSION_COOKIE_SECURE: z
    .enum(['true', 'false'])
    .optional()
    // Unset stays undefined rather than collapsing to false, so "secure unless
    // told otherwise" can still apply. Transforming undefined to false here made
    // the production default unreachable and shipped a cookie without Secure.
    .transform((v) => (v === undefined ? undefined : v === 'true')),

  /**
   * Trust `X-Forwarded-For` and `X-Forwarded-Proto`.
   *
   * Required behind Railway's router, and dangerous anywhere else: a client can
   * set those headers itself, so trusting them without a proxy in front lets
   * anyone claim any address. Off unless said otherwise.
   */
  /**
   * TLS to the database.
   *
   *  - `off`      — no TLS. Correct for a loopback cluster with trust auth, and
   *                 wrong anywhere the connection crosses a network.
   *  - `require`  — TLS, certificate verified against the system roots.
   *  - `no-verify` — TLS, certificate NOT verified. This still stops passive
   *                 eavesdropping and does NOT stop an active interceptor, so it
   *                 is for a provider whose certificate chain is not publicly
   *                 rooted and nothing else. Railway's private network does not
   *                 need TLS at all; its public proxy does.
   *
   * Defaults to `off` because the default deployment is loopback. A hosted one
   * must say what it wants rather than inherit a guess.
   */
  DATABASE_SSL: z.enum(['off', 'require', 'no-verify']).default('off'),

  TRUST_PROXY: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  // ^ unset means false, which is the safe default here: trusting forwarded
  // headers with no proxy in front lets a client claim any address.
});

export type Env = z.infer<typeof schema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Conditional requirements, evaluated against the raw source.
 *
 * These deliberately do NOT use zod's `superRefine`: a refinement only runs once
 * the whole object has parsed, so a single bad PORT would hide a missing
 * OPERATOR_NAME and the operator would fix one problem, re-run, and discover the
 * next. A configuration error should report everything at once.
 */
function conditionalIssues(source: NodeJS.ProcessEnv): string[] {
  const issues: string[] = [];
  const authMode = source.AUTH_MODE ?? 'none';

  if (authMode === 'password') {
    /*
     * With authentication on there are real accounts, and accounts live in the
     * database. Without one the server would start, accept a login form, and be
     * unable to check anything against it.
     */
    if (!source.DATABASE_URL) {
      issues.push('  DATABASE_URL: required when AUTH_MODE=password — accounts and sessions live in the database');
    }
    /*
     * A session cookie without Secure travels in clear over any plain-HTTP hop.
     * Refused outright in production rather than warned about, because the
     * failure is silent and the consequence is somebody else's session.
     */
    if (source.NODE_ENV === 'production' && source.SESSION_COOKIE_SECURE === 'false') {
      issues.push(
        '  SESSION_COOKIE_SECURE: cannot be false in production — the session cookie would travel in the clear',
      );
    }
    return issues;
  }

  if (!source.OPERATOR_NAME) {
    issues.push(
      '  OPERATOR_NAME: required when AUTH_MODE=none — every write records an actor, so the operator must be named',
    );
  }
  if (!source.OPERATOR_EMAIL) {
    issues.push('  OPERATOR_EMAIL: required when AUTH_MODE=none');
  }
  return issues;
}

/** Parse and validate. Throws ConfigError listing every problem at once. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);

  const issues = parsed.success
    ? []
    : parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);

  issues.push(...conditionalIssues(source));

  if (issues.length) {
    throw new ConfigError(`Invalid configuration:\n${issues.join('\n')}`);
  }
  // Safe: issues is empty, so the parse succeeded.
  return (parsed as { success: true; data: Env }).data;
}
