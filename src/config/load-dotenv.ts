/**
 * Load .env into process.env, if present.
 *
 * Called by the entry points (main.ts, migrate.ts) before anything reads config.
 * Real environment variables always win, so a deployment never has its settings
 * quietly overridden by a file someone left lying around.
 *
 * Deliberately not a dependency: this needs to be readable and to run before
 * everything else, and it is nine lines.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export function loadDotenv(file = path.join(process.cwd(), '.env')): void {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
}
