/**
 * The audit tab.
 *
 * The trail is append-only and hash-chained, so the useful thing a screen can do
 * is not merely list it but *verify* it — and say plainly where it breaks if it
 * does. `/audit/verify` recomputes every hash in order.
 */
import { Controller, Get, Query } from '@nestjs/common';
import { RequiresCapability } from '../policy/policy.guard';
import { AuditRepository, type AuditEvent, type ChainVerification } from './audit.repository';

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditRepository) {}

  @Get()
  @RequiresCapability('audit.read')
  async list(@Query('limit') limit?: string): Promise<{ events: AuditEvent[] }> {
    const n = limit === undefined ? 200 : Math.min(1000, Math.max(1, Number(limit) || 200));
    return { events: await this.audit.list(n) };
  }

  @Get('verify')
  @RequiresCapability('audit.read')
  async verify(): Promise<ChainVerification> {
    return this.audit.verifyChain();
  }
}
