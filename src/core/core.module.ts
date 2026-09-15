/**
 * Shared providers for the HTTP layer.
 *
 * Global, so a feature module declares its controller and nothing else. The
 * alternative — each module building its own pool and repositories — would mean
 * several connection pools in one process and several places that decide how a
 * repository is constructed.
 *
 * The repositories themselves are plain classes taking a `Pool`, not decorated
 * services. That is deliberate: every test in this project builds them directly
 * with a test pool, and keeping them free of the framework is what makes that
 * possible. The wiring lives here instead.
 */
import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { loadEnv, type Env } from '../config/env';
import { ENV } from '../config/env.token';
import { getPool } from '../db/pool';
import { ActorMiddleware } from '../operator/actor.middleware';
import { ProjectsRepository } from '../projects/projects.repository';
import { SlotsRepository } from '../slots/slots.repository';
import { DocumentsRepository } from '../lifecycle/documents.repository';
import { AuditRepository } from '../audit/audit.repository';
import { ReadinessRepository } from '../readiness/readiness.repository';
import { AgeingRepository } from '../ageing/ageing.repository';
import { InboxRepository } from '../reminders/inbox.repository';
import { SettingsRepository } from '../settings/settings.repository';
import { QuizProgressRepository } from '../reviewer/quiz-progress.repository';
import { UploadsRepository } from '../uploads/uploads.repository';
import { STORAGE } from '../storage/storage.token';
import { SCANNER } from '../scan/scanner.token';
import { FilesystemStorage } from '../storage/filesystem.storage';
import type { Storage } from '../storage/storage';
import { ClamAvScanner } from '../scan/clamav.scanner';
import type { Scanner } from '../scan/scanner';
import path from 'node:path';

const fromPool = <T>(Ctor: new (p: Pool) => T) => ({
  provide: Ctor,
  useFactory: (pool: Pool): T => new Ctor(pool),
  inject: [Pool],
});

@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: (): Env => loadEnv() },
    { provide: Pool, useFactory: (env: Env): Pool => getPool(env), inject: [ENV] },
    fromPool(ProjectsRepository),
    fromPool(SlotsRepository),
    fromPool(DocumentsRepository),
    fromPool(AuditRepository),
    fromPool(ReadinessRepository),
    fromPool(AgeingRepository),
    fromPool(InboxRepository),
    fromPool(SettingsRepository),
    fromPool(QuizProgressRepository),

    /*
     * The two seams, bound once.
     *
     * Moving to R2 replaces the STORAGE factory and nothing else — that is what
     * the interface is for. The scanner is bound the same way; `ClamAvScanner`
     * reports itself unavailable without signatures rather than pretending, and
     * the gate treats unavailable as "not a pass".
     */
    {
      provide: STORAGE,
      useFactory: (env: Env): Storage =>
        new FilesystemStorage(env.STORAGE_DIR ?? path.join(process.cwd(), '.blobs')),
      inject: [ENV],
    },
    { provide: SCANNER, useFactory: (): Scanner => new ClamAvScanner() },
    {
      provide: UploadsRepository,
      useFactory: (pool: Pool, storage: Storage, scanner: Scanner): UploadsRepository =>
        new UploadsRepository(pool, storage, scanner),
      inject: [Pool, STORAGE, SCANNER],
    },

    ActorMiddleware,
  ],
  exports: [
    ENV,
    Pool,
    ProjectsRepository,
    SlotsRepository,
    DocumentsRepository,
    AuditRepository,
    ReadinessRepository,
    AgeingRepository,
    InboxRepository,
    SettingsRepository,
    QuizProgressRepository,
    UploadsRepository,
    STORAGE,
    SCANNER,
    ActorMiddleware,
  ],
})
export class CoreModule {}
