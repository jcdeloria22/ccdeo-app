/**
 * Study progress over HTTP.
 *
 * `register.read` throughout, including the writes. A practice score is not an
 * act on a document: it changes nothing anyone else relies on, and demanding a
 * document capability to record one would misdescribe what is happening.
 */
import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { RequiresCapability } from '../policy/policy.guard';
import { QuizProgressRepository, BANKS, type Progress } from './quiz-progress.repository';
import { CurrentActor } from '../operator/current-actor.decorator';
import type { Actor } from '../operator/operator';

@Controller('quiz')
export class QuizController {
  constructor(private readonly progress: QuizProgressRepository) {}

  @Get()
  @RequiresCapability('register.read')
  banks(): { banks: readonly string[] } {
    return { banks: BANKS };
  }

  @Get(':bank')
  @RequiresCapability('register.read')
  async get(@Param('bank') bank: string, @CurrentActor() actor: Actor): Promise<{ progress: Progress | null }> {
    return { progress: await this.progress.get(bank, actor) };
  }

  @Put(':bank')
  @RequiresCapability('register.read')
  async put(
    @Param('bank') bank: string,
    @Body() body: { state?: Record<string, unknown> },
    @CurrentActor() actor: Actor,
  ): Promise<{ progress: Progress }> {
    return { progress: await this.progress.put(bank, body?.state ?? {}, actor) };
  }

  @Delete(':bank')
  @RequiresCapability('register.read')
  async clear(@Param('bank') bank: string, @CurrentActor() actor: Actor): Promise<{ cleared: boolean }> {
    return { cleared: await this.progress.clear(bank, actor) };
  }
}
