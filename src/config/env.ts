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
  if (authMode !== 'none') return issues;

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
