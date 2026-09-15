/** The audit feature. Providers are shared; see src/core/core.module.ts. */
import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';

@Module({ controllers: [AuditController] })
export class AuditModule {}
