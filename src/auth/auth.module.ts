/** Accounts and sessions. Providers are shared; see src/core/core.module.ts. */
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';

@Module({ controllers: [AuthController] })
export class AuthModule {}
