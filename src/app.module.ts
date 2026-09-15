/**
 * Root module.
 *
 * The policy guard is registered here as an APP_GUARD so it covers every
 * controller in the application — including any added later. Registering it per
 * feature would mean the next module ships unprotected the first time someone
 * forgets a line, which is exactly what deny-by-default exists to prevent.
 *
 * `ActorMiddleware` runs on every route for the same reason: the guard refuses a
 * request with no actor, and attaching one per controller would be a rule kept by
 * hand.
 */
import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { CoreModule } from './core/core.module';
import { PolicyGuard } from './policy/policy.guard';
import { ActorMiddleware } from './operator/actor.middleware';
import { RemindersModule } from './reminders/reminders.module';
import { ProjectsModule } from './projects/projects.module';
import { ReadinessModule } from './readiness/readiness.module';
import { AuditModule } from './audit/audit.module';
import { UploadsModule } from './uploads/uploads.module';
import { DocumentsModule } from './lifecycle/documents.module';
import { DevStorageModule } from './storage/dev-storage.module';
import { SlotsModule } from './slots/slots.module';
import { LifecycleModule } from './lifecycle/lifecycle.module';
import { SettingsModule } from './settings/settings.module';
import { QuizModule } from './reviewer/quiz.module';
import { QcpModule } from './generators/qcp/qcp.module';
import { DomainExceptionFilter } from './http/domain-exception.filter';

@Module({
  imports: [
    CoreModule,
    RemindersModule,
    ProjectsModule,
    ReadinessModule,
    AuditModule,
    UploadsModule,
    DocumentsModule,
    DevStorageModule,
    SlotsModule,
    LifecycleModule,
    SettingsModule,
    QuizModule,
    QcpModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: PolicyGuard },
    /* Domain refusals carry their own meaning; without this they all read 500. */
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ActorMiddleware).forRoutes('*');
  }
}
