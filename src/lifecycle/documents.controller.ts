/**
 * The lifecycle, over HTTP.
 *
 * One route moves a document, whatever the move is. The alternative — a route
 * per verb, `/finalize`, `/sign`, `/void` — would put the transition table in the
 * URL space as well as in `states.ts`, and the two would drift. Here the target
 * state is the payload and `transition()` decides whether it is legal, so the
 * machine stays in one place and the API cannot disagree with it.
 *
 * Every refusal it raises — not in the table, wrong role, no reason, content that
 * never passed the scan gate — reaches the client with the rule that stopped it.
 */
import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { RequiresCapability } from '../policy/policy.guard';
import { DocumentsRepository, type Document, type DocumentTransition } from './documents.repository';
import { STATES, type DocumentState } from './states';
import { CurrentActor } from '../operator/current-actor.decorator';
import type { Actor } from '../operator/operator';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsRepository) {}

  @Get(':id')
  @RequiresCapability('register.read')
  async find(@Param('id', new ParseUUIDPipe()) id: string): Promise<{
    document: Document;
    history: DocumentTransition[];
    approvalCoversContent: boolean;
  }> {
    const document = await this.documents.find(id);
    if (!document) throw new NotFoundException(`No document ${id}`);

    const [history, approvalCoversContent] = await Promise.all([
      this.documents.history(id),
      this.documents.approvalCoversCurrentContent(id),
    ]);
    return { document, history, approvalCoversContent };
  }

  @Post()
  @RequiresCapability('document.create')
  async create(
    @Body() body: { projectId?: string; slotCode?: string; title?: string; uploadId?: string | null },
    @CurrentActor() actor: Actor,
  ): Promise<{ document: Document }> {
    if (!body?.projectId) throw new BadRequestException('projectId is required');
    if (!body?.slotCode?.trim()) throw new BadRequestException('slotCode is required');
    if (!body?.title?.trim()) throw new BadRequestException('title is required');

    const document = await this.documents.create(
      {
        projectId: body.projectId,
        slotCode: body.slotCode.trim(),
        title: body.title.trim(),
        uploadId: body.uploadId ?? null,
      },
      actor,
    );
    return { document };
  }

  /**
   * Move it.
   *
   * `document.edit` is the capability to *attempt* a move; which moves are
   * actually permitted is the transition table's business, and it checks the
   * capability the specific transition requires on top of this one. The guard
   * cannot express "depends on the target state", so the coarse check is here and
   * the real one is in `transition()`.
   */
  @Post(':id/transition')
  @RequiresCapability('document.edit')
  async transition(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { to?: string; reason?: string | null },
    @CurrentActor() actor: Actor,
  ): Promise<{ document: Document }> {
    const to = body?.to;
    if (!to || !(STATES as readonly string[]).includes(to)) {
      throw new BadRequestException(`to must be one of: ${STATES.join(', ')}`);
    }
    if (!(await this.documents.find(id))) throw new NotFoundException(`No document ${id}`);

    const document = await this.documents.transition(id, to as DocumentState, actor, { reason: body?.reason ?? null });
    return { document };
  }

  /**
   * Replace an approved document.
   *
   *   > Content is immutable at approval. Any later change is a new version,
   *   > which supersedes the approved one and returns the document to Draft.
   */
  @Post(':id/supersede')
  @RequiresCapability('document.edit')
  async supersede(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { uploadId?: string; reason?: string },
    @CurrentActor() actor: Actor,
  ): Promise<{ superseded: Document; replacement: Document }> {
    if (!body?.uploadId) throw new BadRequestException('uploadId is required — a supersede needs the new version');
    if (!(await this.documents.find(id))) throw new NotFoundException(`No document ${id}`);

    return this.documents.supersede(id, body.uploadId, body?.reason ?? '', actor);
  }
}
