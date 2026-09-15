/** The reminders feature. Providers are shared; see src/core/core.module.ts. */
import { Module } from '@nestjs/common';
import { RemindersController } from './reminders.controller';

@Module({ controllers: [RemindersController] })
export class RemindersModule {}
