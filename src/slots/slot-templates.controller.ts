/**
 * Slot templates — the required-document sets.
 *
 * Without these routes a fresh install can never define what a contract owes,
 * which makes every other route unusable: a document belongs to a slot, and a
 * slot comes from a template.
 *
 * Versioned on purpose, and the version is the whole point:
 *
 *   > A project's slots are copied from one template version at the moment they
 *   > are created, and a later version never reaches back and changes them.
 *
 * So a correction is a NEW version, published; contracts already created keep the
 * version they were created under. That is what stops a readiness figure computed
 * last month from silently meaning something different today.
 *
 * Every version starts `provisional` with an unverified source note. me-spec-sources
 * puts required-document sets at tier 3, and a list whose provenance cannot be
 * named must never look verified.
 */
import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { RequiresCapability } from '../policy/policy.guard';
import { SlotsRepository, type SlotTemplate, type SlotTemplateItem } from './slots.repository';
import { CurrentActor } from '../operator/current-actor.decorator';
import type { Actor } from '../operator/operator';

interface NewItem {
  slotCode?: string;
  name?: string;
  required?: boolean;
}

@Controller('slot-templates')
export class SlotTemplatesController {
  constructor(private readonly slots: SlotsRepository) {}

  /** The version currently active for a code, and what is in it. */
  @Get(':code')
  @RequiresCapability('register.read')
  async active(@Param('code') code: string): Promise<{ template: SlotTemplate | null; items: SlotTemplateItem[] }> {
    const template = await this.slots.activeTemplate(code);
    return { template, items: template ? await this.slots.items(template.id) : [] };
  }

  /**
   * Draft a new version.
   *
   * Created as a draft rather than active: publishing is a separate act, so a
   * half-written set cannot start being copied onto contracts the moment it is
   * saved.
   */
  @Post()
  @RequiresCapability('project.edit')
  async create(
    @Body() body: { code?: string; name?: string; items?: NewItem[]; provisional?: boolean; sourceNote?: string },
    @CurrentActor() actor: Actor,
  ): Promise<{ template: SlotTemplate }> {
    if (!body?.code?.trim()) throw new BadRequestException('code is required');
    if (!body?.name?.trim()) throw new BadRequestException('name is required');
    if (!Array.isArray(body.items) || body.items.length === 0) {
      throw new BadRequestException('items must list at least one slot — an empty set requires nothing of anybody');
    }

    const items = body.items.map((raw, i) => {
      if (!raw?.slotCode?.trim()) throw new BadRequestException(`items[${i}].slotCode is required`);
      if (!raw?.name?.trim()) throw new BadRequestException(`items[${i}].name is required`);
      return { slotCode: raw.slotCode.trim(), name: raw.name.trim(), required: raw.required !== false };
    });

    const codes = items.map((i) => i.slotCode);
    const duplicate = codes.find((c, i) => codes.indexOf(c) !== i);
    if (duplicate) throw new BadRequestException(`items repeats the slot "${duplicate}"`);

    const template = await this.slots.createVersion(
      {
        code: body.code.trim(),
        name: body.name.trim(),
        items,
        provisional: body.provisional ?? true,
        sourceNote: body.sourceNote ?? 'unverified',
      },
      actor,
    );
    return { template };
  }

  /** Make a draft the active version. The previous active one becomes superseded. */
  @Post(':id/publish')
  @RequiresCapability('project.edit')
  async publish(@Param('id', new ParseUUIDPipe()) id: string): Promise<{ template: SlotTemplate }> {
    return { template: await this.slots.publish(id) };
  }
}
