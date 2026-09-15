/** Office reference data. Providers are shared; see src/core/core.module.ts. */
import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';

@Module({ controllers: [SettingsController] })
export class SettingsModule {}
