/**
 * The readiness tab.
 *
 *   > Readiness counts Signed only, never Final. Approval debt is displayed
 *   > separately and never folded into a completion percentage.
 *
 * Which is why the debt is its own route rather than a field on the portfolio:
 * two numbers that must never be added together should not arrive as one object
 * that invites someone to add them.
 */
import { Controller, Get, Query } from '@nestjs/common';
import { RequiresCapability } from '../policy/policy.guard';
import { ReadinessRepository, type ApprovalDebtItem, type ProjectReadiness } from './readiness.repository';

@Controller('readiness')
export class ReadinessController {
  constructor(private readonly readiness: ReadinessRepository) {}

  @Get()
  @RequiresCapability('register.read')
  async portfolio(): Promise<{ projects: ProjectReadiness[] }> {
    return { projects: await this.readiness.portfolio() };
  }

  /** What is sitting at Final. Listed, never counted into a percentage. */
  @Get('debt')
  @RequiresCapability('register.read')
  async debt(@Query('projectId') projectId?: string): Promise<{ items: ApprovalDebtItem[] }> {
    return { items: await this.readiness.approvalDebt(projectId) };
  }
}
