/** The reviewers' progress. Providers are shared; see src/core/core.module.ts. */
import { Module } from '@nestjs/common';
import { QuizController } from './quiz.controller';

@Module({ controllers: [QuizController] })
export class QuizModule {}
