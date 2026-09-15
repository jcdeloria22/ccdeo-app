/** The uploads feature. Providers are shared; see src/core/core.module.ts. */
import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';

@Module({ controllers: [UploadsController] })
export class UploadsModule {}
