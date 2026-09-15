/** The QCP generator's read surface. Rules are edited in rules.ts, never over HTTP. */
import { Module } from '@nestjs/common';
import { QcpRulesController } from './qcp-rules.controller';

@Module({ controllers: [QcpRulesController] })
export class QcpModule {}
