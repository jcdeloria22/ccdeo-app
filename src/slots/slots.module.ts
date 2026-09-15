/** Slot templates. Providers are shared; see src/core/core.module.ts. */
import { Module } from '@nestjs/common';
import { SlotTemplatesController } from './slot-templates.controller';

@Module({ controllers: [SlotTemplatesController] })
export class SlotsModule {}
