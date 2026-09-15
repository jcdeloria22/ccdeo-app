/**
 * Office reference data over HTTP.
 *
 * Reading is a register read; writing needs `project.edit`, because changing a
 * signatory changes what an issued document says. Unknown keys are refused so a
 * typo cannot quietly create a setting nothing reads.
 */
import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { RequiresCapability } from '../policy/policy.guard';
import { SettingsRepository, SETTING_KEYS, type Setting } from './settings.repository';
import { CurrentActor } from '../operator/current-actor.decorator';
import type { Actor } from '../operator/operator';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsRepository) {}

  @Get()
  @RequiresCapability('register.read')
  async all(): Promise<{ known: readonly string[]; settings: Setting[] }> {
    return { known: SETTING_KEYS, settings: await this.settings.all() };
  }

  @Get(':key')
  @RequiresCapability('register.read')
  async one(@Param('key') key: string): Promise<{ setting: Setting | null }> {
    return { setting: await this.settings.get(key) };
  }

  @Put(':key')
  @RequiresCapability('project.edit')
  async put(
    @Param('key') key: string,
    @Body() body: { value?: unknown },
    @CurrentActor() actor: Actor,
  ): Promise<{ setting: Setting }> {
    return { setting: await this.settings.put(key, body?.value ?? null, actor) };
  }
}
