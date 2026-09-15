/** The documents feature. Providers are shared; see src/core/core.module.ts. */
import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';

@Module({ controllers: [DocumentsController] })
export class DocumentsModule {}
