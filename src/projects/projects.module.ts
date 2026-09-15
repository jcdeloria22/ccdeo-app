/** The projects feature. Providers are shared; see src/core/core.module.ts. */
import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';

@Module({ controllers: [ProjectsController] })
export class ProjectsModule {}
