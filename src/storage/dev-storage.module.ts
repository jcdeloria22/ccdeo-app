/** The devstorage feature. Providers are shared; see src/core/core.module.ts. */
import { Module } from '@nestjs/common';
import { DevStorageController } from './dev-storage.controller';

@Module({ controllers: [DevStorageController] })
export class DevStorageModule {}
