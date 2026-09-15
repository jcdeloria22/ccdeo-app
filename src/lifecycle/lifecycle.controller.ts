/**
 * The lifecycle, described to the client.
 *
 * The screen has to know which moves are possible from a given state, whether
 * each needs a reason, and who may make it — otherwise it either offers buttons
 * that fail or hides moves that would have worked. Copying the transition table
 * into the frontend would answer that and then drift from `states.ts` the first
 * time either changed.
 *
 * So the table is served. One source, and a UI that cannot disagree with the
 * machine it is driving.
 */
import { Controller, Get } from '@nestjs/common';
import { RequiresCapability } from '../policy/policy.guard';
import { STATES, TERMINAL, TRANSITIONS, type Transition } from './states';

export interface LifecycleDescription {
  states: readonly string[];
  terminal: readonly string[];
  /** The usual forward path, for showing someone where a document has got to. */
  mainLine: readonly string[];
  transitions: readonly Transition[];
}

@Controller('lifecycle')
export class LifecycleController {
  @Get()
  @RequiresCapability('register.read')
  describe(): LifecycleDescription {
    return {
      states: STATES,
      terminal: TERMINAL,
      mainLine: ['Draft', 'In Review', 'Final', 'Signed', 'Archived'],
      transitions: TRANSITIONS,
    };
  }
}
