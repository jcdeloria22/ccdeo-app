/**
 * The register.
 *
 * A list of contracts and what each one still owes. The readiness figure comes
 * from `ReadinessRepository`, so the register and the readiness tab can never
 * disagree — there is one implementation of "what counts as done" and both read
 * it.
 */
import {
  BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query,
} from '@nestjs/common';
import { RequiresCapability } from '../policy/policy.guard';
import { ProjectsRepository, type Project } from './projects.repository';
import { SlotsRepository, type ProjectSlot } from '../slots/slots.repository';
import { DocumentsRepository, type Document } from '../lifecycle/documents.repository';
import { ReadinessRepository, type ProjectReadiness } from '../readiness/readiness.repository';
import { CurrentActor } from '../operator/current-actor.decorator';
import type { Actor } from '../operator/operator';

export interface RegisterRow {
  project: Project;
  readiness: ProjectReadiness['readiness'] | null;
}

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsRepository,
    private readonly slots: SlotsRepository,
    private readonly documents: DocumentsRepository,
    private readonly readiness: ReadinessRepository,
  ) {}

  @Get()
  @RequiresCapability('register.read')
  async list(@Query('limit') limit?: string): Promise<{ rows: RegisterRow[]; total: number }> {
    const n = limit === undefined ? 100 : Math.min(500, Math.max(1, Number(limit) || 100));
    const [projects, total] = await Promise.all([this.projects.list(n), this.projects.count()]);

    /*
     * Readiness per project, in sequence rather than in parallel.
     *
     * Each call runs its own query; firing a hundred at once would occupy the
     * whole pool and starve every other request on the server. A register that
     * loads a little slower is better than one that blocks the reminders tab.
     */
    const rows: RegisterRow[] = [];
    for (const project of projects) {
      const r = await this.readiness.forProject(project.id);
      rows.push({ project, readiness: r ? r.readiness : null });
    }
    return { rows, total };
  }

  @Get(':id')
  @RequiresCapability('register.read')
  async detail(@Param('id', new ParseUUIDPipe()) id: string): Promise<{
    project: Project;
    readiness: ProjectReadiness | null;
    slots: ProjectSlot[];
    documents: Document[];
  }> {
    const project = await this.projects.findById(id);
    if (!project) throw new NotFoundException(`No project ${id}`);

    const [readiness, slots, documents] = await Promise.all([
      this.readiness.forProject(id),
      this.slots.forProject(id),
      this.documents.forProject(id),
    ]);
    return { project, readiness, slots, documents };
  }

  /**
   * Create a contract.
   *
   * The duplicate guard lives in the database — a generated column and a unique
   * index — so two requests racing on the same contract number cannot both win.
   * The repository turns that into `DuplicateProjectError`, which the exception
   * filter answers as 409 rather than 500.
   */
  @Post()
  @RequiresCapability('project.create')
  async create(
    @Body() body: { contractId?: string; name?: string; location?: string | null },
    @CurrentActor() actor: Actor,
  ): Promise<{ project: Project }> {
    if (!body?.contractId?.trim()) throw new BadRequestException('contractId is required');
    if (!body?.name?.trim()) throw new BadRequestException('name is required');

    const project = await this.projects.create(
      { contractId: body.contractId.trim(), name: body.name.trim(), location: body.location ?? null },
      actor,
    );
    return { project };
  }

  /**
   * Give a contract its slot set.
   *
   * Slots are copied from the template version active at this moment and frozen.
   * A later template version never reaches back — a set that silently gained a
   * requirement would make every readiness figure computed before it a lie.
   */
  @Post(':id/slots')
  @RequiresCapability('project.edit')
  async instantiate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { templateCode?: string },
  ): Promise<{ slots: ProjectSlot[] }> {
    if (!body?.templateCode?.trim()) throw new BadRequestException('templateCode is required');
    if (!(await this.projects.findById(id))) throw new NotFoundException(`No project ${id}`);

    return { slots: await this.slots.instantiate(id, body.templateCode.trim()) };
  }

  /** Waive a slot. A waiver without a reason is not a waiver, it is a gap. */
  @Post(':id/slots/:slotCode/waive')
  @RequiresCapability('slot.waive')
  async waive(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('slotCode') slotCode: string,
    @Body() body: { reason?: string },
    @CurrentActor() actor: Actor,
  ): Promise<{ slot: ProjectSlot }> {
    return { slot: await this.slots.waive(id, slotCode, body?.reason ?? '', actor) };
  }
}
