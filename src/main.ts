/**
 * Bootstrap.
 *
 * Order matters and is the whole point of DC-01: configuration is validated, then
 * the bind guard runs, and only then is a socket opened. The guard cannot be
 * bypassed by a misconfiguration because nothing listens before it returns.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { loadDotenv } from './config/load-dotenv';
import { loadEnv } from './config/env';
import { assertSafeBind } from './config/bind-guard';
import { seededOperator } from './operator/operator';

export async function bootstrap(): Promise<void> {
  loadDotenv();
  const env = loadEnv();

  // Before anything binds.
  assertSafeBind(env);

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['log', 'warn', 'error'] });

  /*
   * The built frontend, served from the same origin as the API.
   *
   * One origin means no CORS to configure, which matters more here than it
   * usually would: the bind guard keeps this on loopback while AUTH_MODE=none,
   * and a cross-origin setup would invite someone to relax that to make the
   * browser happy. Absent (before `npm run build:web`) it simply serves nothing.
   */
  const web = join(__dirname, '..', 'web', 'dist');
  const hasWeb = existsSync(join(web, 'index.html'));
  if (hasWeb) app.useStaticAssets(web);

  /*
   * Text-recognition assets, served rather than bundled.
   *
   * ~15 MB that only a scanned PDF needs. Kept out of the frontend build so the
   * build stays fast and the browser fetches it the first time OCR actually
   * runs. Absent, the Builder says so and offers pasting instead of failing.
   */
  const ocr = join(__dirname, '..', 'ocr-assets');
  const hasOcr = existsSync(join(ocr, 'worker.min.js'));
  if (hasOcr) app.useStaticAssets(ocr, { prefix: '/ocr/' });

  await app.listen(env.PORT, env.BIND_HOST);

  const who = env.AUTH_MODE === 'none' ? seededOperator(env) : null;
  // eslint-disable-next-line no-console
  console.log(
    [
      `dpwh-doc-control listening on http://${env.BIND_HOST}:${env.PORT}`,
      `  auth      : ${env.AUTH_MODE}`,
      who ? `  operator  : ${who.name} <${who.email}> as ${who.role}` : '  operator  : from session',
      env.DATABASE_URL ? '  database  : configured' : '  database  : not configured (required from DC-02)',
      hasWeb ? '  web       : served from web/dist' : '  web       : not built (npm run build:web, or npm run dev:web)',
      hasOcr ? '  ocr       : available' : '  ocr       : absent (npm run sync:vendored) — scanned PDFs need pasting',
    ].join('\n'),
  );
}

// Only self-start when run directly, so tests can import without binding a port.
if (require.main === module) {
  bootstrap().catch((err: unknown) => {
    const e = err as Error;
    // eslint-disable-next-line no-console
    console.error(`\n${e.name ?? 'Error'}: ${e.message}\n`);
    process.exit(1);
  });
}
