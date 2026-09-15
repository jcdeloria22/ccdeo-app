/**
 * Domain errors and the statuses they mean.
 *
 * The filter maps by class NAME, which keeps it from importing every module in
 * the application just to name its errors — but a rename would then silently
 * turn a 403 back into a 500, and nothing about that failure looks like a
 * failure. So every name in the map is checked against the class that actually
 * throws it, and every domain error class is checked to be in the map.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Logger } from '@nestjs/common';
import { HttpStatus, HttpException, NotFoundException } from '@nestjs/common';
import { DomainExceptionFilter, STATUS_BY_ERROR } from '../src/http/domain-exception.filter';
import { DuplicateProjectError } from '../src/projects/projects.repository';
import { NoActiveTemplateError, WaiverNeedsReasonError } from '../src/slots/slots.repository';
import { SlotNotOnProjectError } from '../src/uploads/uploads.repository';
import { ContentMismatchError, ObjectNotFoundError } from '../src/storage/storage';
import { UnverifiedRuleError } from '../src/generators/provenance';
import { UnknownSettingError } from '../src/settings/settings.repository';
import { UnknownBankError } from '../src/reviewer/quiz-progress.repository';
import { DuplicateUserError, UnknownRoleError, UnknownUserError } from '../src/auth/users.repository';
import { WeakPasswordError } from '../src/auth/password';
import {
  ContentNotCleanError,
  IllegalTransitionError,
  NoContentToFreezeError,
  ReasonRequiredError,
  RoleNotPermittedError,
} from '../src/lifecycle/documents.repository';

/** One instance of every domain error, built the way the code really builds them. */
const INSTANCES: Error[] = [
  new DuplicateProjectError('26HH0001', null),
  new NoActiveTemplateError('demo-set'),
  new WaiverNeedsReasonError(),
  new SlotNotOnProjectError('p1', 'qcp'),
  new ContentMismatchError('blobs/aa/bb/cc'),
  new ObjectNotFoundError('blobs/aa/bb/cc'),
  new UnverifiedRuleError('qc.200.cbr', {
    sourceDocument: 'x', sourceSection: 'y', sourceYear: 2004, tier: 1, verifiedBy: null, verifiedOn: null,
  }),
  new IllegalTransitionError('Draft', 'Signed'),
  new ReasonRequiredError('Final', 'Draft'),
  new RoleNotPermittedError('viewer', 'Draft', 'Final', 'because'),
  new NoContentToFreezeError(),
  new ContentNotCleanError('Quarantined'),
  new UnknownSettingError('builder.nonsense'),
  new UnknownBankError('xx'),
  new UnknownUserError('nobody'),
  new UnknownRoleError('superuser'),
  new DuplicateUserError('me@dpwh.gov.ph'),
  new WeakPasswordError(['it must be at least 12 characters']),
];

/** A response just real enough for the filter. */
function capture() {
  const out: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      out.status = code;
      return this;
    },
    json(body: unknown) {
      out.body = body;
      return this;
    },
  };
  const host = { switchToHttp: () => ({ getResponse: () => res }) };
  return { out, host: host as never };
}

/*
 * The filter logs an unrecognised error in full, on purpose — that is where the
 * details go instead of to the client. Silenced here so a deliberate case does
 * not print a stack trace that reads like a failing run.
 */
beforeAll(() => {
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterAll(() => {
  vi.restoreAllMocks();
});

const run = (e: unknown) => {
  const { out, host } = capture();
  new DomainExceptionFilter().catch(e, host);
  return out as { status: number; body: { statusCode: number; error?: string; message: string } };
};

describe('the map', () => {
  it('names a real class for every entry', () => {
    const real = new Set(INSTANCES.map((e) => e.name));
    for (const name of Object.keys(STATUS_BY_ERROR)) {
      expect(real.has(name), `${name} is mapped but no class throws it — a rename would go unnoticed`).toBe(true);
    }
  });

  it('has an entry for every domain error', () => {
    for (const e of INSTANCES) {
      expect(STATUS_BY_ERROR[e.name], `${e.name} is unmapped and would reach the client as a 500`).toBeDefined();
    }
  });

  it('sets its own name on each error, rather than inheriting Error', () => {
    for (const e of INSTANCES) expect(e.name).not.toBe('Error');
  });
});

describe('what the client is told', () => {
  it('answers a refusal with its status and the rule that stopped it', () => {
    const r = run(new IllegalTransitionError('Draft', 'Signed'));
    expect(r.status).toBe(HttpStatus.CONFLICT);
    expect(r.body.error).toBe('IllegalTransitionError');
    expect(r.body.message).toMatch(/No transition Draft → Signed/);
    expect(r.body.message).toMatch(/deny-by-default/);
  });

  it('calls a role refusal 403, not 500', () => {
    expect(run(new RoleNotPermittedError('viewer', 'Draft', 'Final', 'restricted')).status).toBe(HttpStatus.FORBIDDEN);
  });

  it('calls a duplicate contract 409', () => {
    expect(run(new DuplicateProjectError('26HH0001', null)).status).toBe(HttpStatus.CONFLICT);
  });

  it('calls a missing reason 400', () => {
    expect(run(new ReasonRequiredError('Final', 'Draft')).status).toBe(HttpStatus.BAD_REQUEST);
    expect(run(new WaiverNeedsReasonError()).status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('calls content the scan gate never passed 409, and says so', () => {
    const r = run(new ContentNotCleanError('Quarantined'));
    expect(r.status).toBe(HttpStatus.CONFLICT);
    expect(r.body.message).toMatch(/explicit Clean verdict only/);
  });

  it('calls an unverified rule 422', () => {
    expect(run(INSTANCES.find((e) => e.name === 'UnverifiedRuleError')!).status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
  });

  it('leaves Nest exceptions alone', () => {
    const r = run(new NotFoundException('No project p9'));
    expect(r.status).toBe(HttpStatus.NOT_FOUND);
    expect(r.body.message).toBe('No project p9');
  });

  it('passes a plain HttpException body through unchanged', () => {
    const r = run(new HttpException('teapot', 418));
    expect(r.status).toBe(418);
    expect(r.body.message).toBe('teapot');
  });

  /**
   * An unmapped error may carry a connection string or a row's contents, and the
   * client is not the place to find that out. It is logged in full instead.
   */
  it('tells the client nothing about an error it does not recognise', () => {
    const r = run(new Error('connection to postgres://user:hunter2@host failed'));
    expect(r.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(r.body.message).not.toMatch(/hunter2|postgres/);
    expect(r.body.message).toMatch(/server log/);
  });

  it('survives something thrown that is not an Error at all', () => {
    const r = run('a bare string');
    expect(r.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });
});
