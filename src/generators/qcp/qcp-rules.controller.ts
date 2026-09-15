/**
 * The verified testing rules, readable.
 *
 * This exists because of a specific hazard. The ME Workflow's testing tables are
 * lecture material — tier 0 — and one of their notes still reads that the Item
 * 200 soaked CBR is "unresolved between editions … know both". This project has
 * since resolved it from the 2013 Standard Specifications held in the vault, and
 * a study screen that contradicts the project's own verified record is worse than
 * one that says nothing.
 *
 * So the record is served rather than copied. The alternative — writing the
 * settled value into the frontend beside the vendored table — would put the same
 * specification value in two places, which is precisely how the two editions came
 * to disagree in the first place.
 *
 * Read-only, and deliberately so. Rules are changed by editing `rules.ts` with a
 * source in hand, never over HTTP.
 */
import { Controller, Get } from '@nestjs/common';
import { RequiresCapability } from '../../policy/policy.guard';
import { QCP_RULES_VERSION, QCP_TESTING_RULES, coveredItems, type TestingRule } from './rules';

@Controller('generators/qcp')
export class QcpRulesController {
  @Get('rules')
  @RequiresCapability('register.read')
  rules(): {
    version: string;
    items: string[];
    rules: readonly TestingRule[];
  } {
    return {
      version: QCP_RULES_VERSION,
      items: coveredItems(),
      rules: QCP_TESTING_RULES,
    };
  }
}
