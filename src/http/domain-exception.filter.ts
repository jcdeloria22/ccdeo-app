/**
 * Domain errors, given the HTTP status they actually mean.
 *
 * The repositories throw typed errors — a transition that is not in the table, a
 * reason that is missing, content the scan gate never passed. Without this every
 * one of them reaches the client as a 500, which says "the server is broken" when
 * what happened is "you may not do that, and here is why". The difference matters
 * on a screen where the refusal IS the feature: an operator told 500 retries; an
 * operator told 409 with the rule reads the rule.
 *
 * Mapping by class name rather than by `instanceof` keeps this file from
 * importing every module in the application just to name its errors. The names
 * are asserted in `test/http-errors.spec.ts`, so a rename cannot quietly turn a
 * 403 back into a 500.
 */
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * What each domain error means over HTTP.
 *
 *   403 — the actor may not do this.
 *   404 — the thing named does not exist.
 *   409 — the request is well formed but conflicts with the current state.
 *   422 — the request is understood but cannot be carried out as asked.
 *   400 — the request is missing something it must carry.
 */
export const STATUS_BY_ERROR: Readonly<Record<string, HttpStatus>> = {
  // policy
  RoleNotPermittedError: HttpStatus.FORBIDDEN,

  // not found
  SlotNotOnProjectError: HttpStatus.NOT_FOUND,
  ObjectNotFoundError: HttpStatus.NOT_FOUND,

  // conflicts with the state something is already in
  DuplicateProjectError: HttpStatus.CONFLICT,
  IllegalTransitionError: HttpStatus.CONFLICT,
  NoContentToFreezeError: HttpStatus.CONFLICT,
  ContentNotCleanError: HttpStatus.CONFLICT,
  ContentMismatchError: HttpStatus.CONFLICT,

  // understood, but cannot be carried out
  NoActiveTemplateError: HttpStatus.UNPROCESSABLE_ENTITY,
  UnknownSettingError: HttpStatus.NOT_FOUND,
  UnknownBankError: HttpStatus.NOT_FOUND,
  UnverifiedRuleError: HttpStatus.UNPROCESSABLE_ENTITY,

  // the request is missing something
  ReasonRequiredError: HttpStatus.BAD_REQUEST,
  WaiverNeedsReasonError: HttpStatus.BAD_REQUEST,
};

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger('DomainExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    // Nest's own exceptions already carry a status and a shaped body.
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      res.status(exception.getStatus()).json(typeof body === 'string' ? { message: body } : body);
      return;
    }

    const err = exception as Error;
    const status = STATUS_BY_ERROR[err?.name];

    if (status === undefined) {
      /*
       * Genuinely unexpected. Logged in full and answered with a generic body:
       * an unmapped error may carry a connection string or a row's contents, and
       * the client is not the place to find that out.
       */
      this.log.error(`Unhandled ${err?.name ?? 'error'}: ${err?.message}`, err?.stack);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Something went wrong. The details are in the server log.',
      });
      return;
    }

    // A domain refusal is not a server fault; the message IS the explanation.
    res.status(status).json({ statusCode: status, error: err.name, message: err.message });
  }
}
