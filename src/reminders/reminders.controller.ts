/**
 * The reminders space.
 *
 * Its own routes rather than a corner of the readiness dashboard, because the two
 * answer different questions. Readiness asks "is this project ready to submit";
 * the inbox asks "what needs me". Folding the second into the first is how a
 * backlog becomes invisible, which is the failure this whole product is aimed at.
 *
 * Every handler declares the capability it needs. The guard denies anything that
 * does not, so a route added in a hurry fails closed rather than open.
 */
import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { RequiresCapability, type PolicyRequest } from '../policy/policy.guard';
import { InboxRepository, type InboxCounts, type InboxItem } from './inbox.repository';
import { AgeingRepository } from '../ageing/ageing.repository';
import type { AgeingPanel } from '../ageing/ageing.repository';
import type { Actor } from '../operator/operator';

type Req = Request & PolicyRequest;

/** The guard guarantees this; the cast is contained here rather than in every handler. */
const actorOf = (req: Req): Actor => req.actor as Actor;

@Controller('reminders')
export class RemindersController {
  constructor(
    private readonly inbox: InboxRepository,
    private readonly ageing: AgeingRepository,
  ) {}

  /** What is in the inbox. Unread first, most severe first, oldest first. */
  @Get()
  @RequiresCapability('register.read')
  async list(
    @Req() req: Req,
    @Query('projectId') projectId?: string,
    @Query('unread') unread?: string,
    @Query('limit') limit?: string,
  ): Promise<{ items: InboxItem[]; counts: InboxCounts }> {
    const actor = actorOf(req);
    const parsedLimit = limit === undefined ? undefined : Number(limit);
    if (parsedLimit !== undefined && (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 500)) {
      throw new BadRequestException('limit must be a whole number between 1 and 500');
    }

    const [items, counts] = await Promise.all([
      this.inbox.list(actor, { projectId, unreadOnly: unread === 'true', limit: parsedLimit }),
      this.inbox.counts(actor, projectId),
    ]);
    return { items, counts };
  }

  /** The number on the tab. Its own route so a badge does not have to fetch the list. */
  @Get('counts')
  @RequiresCapability('register.read')
  async counts(@Req() req: Req, @Query('projectId') projectId?: string): Promise<InboxCounts> {
    return this.inbox.counts(actorOf(req), projectId);
  }

  /**
   * The ageing panel behind the inbox.
   *
   * `now` is the server's clock here, which is correct for a view — the purity
   * rule is about the engine, and `AgeingRepository.panel()` still takes the time
   * as an argument so tests never depend on when they run.
   */
  @Get('ageing')
  @RequiresCapability('register.read')
  async panel(@Req() _req: Req, @Query('projectId') projectId?: string): Promise<AgeingPanel> {
    return this.ageing.panel(new Date(), projectId);
  }

  /**
   * Run the ageing engine now.
   *
   * On a schedule this would be a cron; with one operator on one machine there is
   * no scheduler running, so the inbox would stay empty until something invoked
   * it. Safe to press repeatedly — the reminder table's unique key is the
   * deduplication rule, so a second run over the same state of the world raises
   * nothing.
   */
  @Post('run')
  @RequiresCapability('register.read')
  async run(
    @Req() req: Req,
    @Query('projectId') projectId?: string,
  ): Promise<{ raised: number; counts: InboxCounts }> {
    const actor = actorOf(req);
    const raised = await this.ageing.run(new Date(), actor, projectId);
    return { raised: raised.length, counts: await this.inbox.counts(actor, projectId) };
  }

  @Post(':id/acknowledge')
  @RequiresCapability('register.read')
  async acknowledge(
    @Req() req: Req,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ reminderId: string; newlyAcknowledged: boolean; item: InboxItem }> {
    const actor = actorOf(req);

    // Checked first so an unknown id is a 404 rather than a foreign-key error.
    if (!(await this.inbox.find(actor, id))) throw new NotFoundException(`No reminder ${id}`);

    const newlyAcknowledged = await this.inbox.acknowledge(actor, id);
    const item = await this.inbox.find(actor, id);
    return { reminderId: id, newlyAcknowledged, item: item as InboxItem };
  }

  /** Clear the tab. Reports how many were newly marked, not how many exist. */
  @Post('acknowledge-all')
  @RequiresCapability('register.read')
  async acknowledgeAll(
    @Req() req: Req,
    @Query('projectId') projectId?: string,
  ): Promise<{ acknowledged: number; counts: InboxCounts }> {
    const actor = actorOf(req);
    const acknowledged = await this.inbox.acknowledgeAll(actor, projectId);
    return { acknowledged, counts: await this.inbox.counts(actor, projectId) };
  }
}
