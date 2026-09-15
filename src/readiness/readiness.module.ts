/** The readiness feature. Providers are shared; see src/core/core.module.ts. */
import { Module } from '@nestjs/common';
import { ReadinessController } from './readiness.controller';

@Module({ controllers: [ReadinessController] })
export class ReadinessModule {}
