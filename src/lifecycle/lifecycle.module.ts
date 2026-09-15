/** The lifecycle description. Providers are shared; see src/core/core.module.ts. */
import { Module } from '@nestjs/common';
import { LifecycleController } from './lifecycle.controller';

@Module({ controllers: [LifecycleController] })
export class LifecycleModule {}
