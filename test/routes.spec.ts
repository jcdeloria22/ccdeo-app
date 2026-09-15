/**
 * Deny-by-default, checked across every controller.
 *
 * The guard refuses a handler that declares no capability. That is only a
 * guarantee if it is true of every route, and the failure mode is silent: a
 * handler added without a decorator does not break a build, it returns 403 the
 * first time someone uses it — or, worse, serves data if the guard is ever
 * loosened.
 *
 * The controller list is checked against the filesystem, so adding a controller
 * and forgetting to list it here fails rather than passing quietly.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { RemindersController } from '../src/reminders/reminders.controller';
import { ProjectsController } from '../src/projects/projects.controller';
import { ReadinessController } from '../src/readiness/readiness.controller';
import { AuditController } from '../src/audit/audit.controller';
import { UploadsController } from '../src/uploads/uploads.controller';
import { DocumentsController } from '../src/lifecycle/documents.controller';
import { DevStorageController } from '../src/storage/dev-storage.controller';
import { SlotTemplatesController } from '../src/slots/slot-templates.controller';
import { LifecycleController } from '../src/lifecycle/lifecycle.controller';
import { SettingsController } from '../src/settings/settings.controller';
import { QuizController } from '../src/reviewer/quiz.controller';
import { QcpRulesController } from '../src/generators/qcp/qcp-rules.controller';
import { AuthController } from '../src/auth/auth.controller';
import { CAPABILITY_KEY, PUBLIC_KEY } from '../src/policy/policy.guard';
import { CAPABILITIES, INTENDED, ROLES, resolve, type Capability, type Role } from '../src/policy/roles';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctor = new (...args: any[]) => object;

const CONTROLLERS: ReadonlyArray<[string, Ctor]> = [
  ['RemindersController', RemindersController],
  ['ProjectsController', ProjectsController],
  ['ReadinessController', ReadinessController],
  ['AuditController', AuditController],
  ['UploadsController', UploadsController],
  ['DocumentsController', DocumentsController],
  ['DevStorageController', DevStorageController],
  ['SlotTemplatesController', SlotTemplatesController],
  ['LifecycleController', LifecycleController],
  ['SettingsController', SettingsController],
  ['QuizController', QuizController],
  ['QcpRulesController', QcpRulesController],
  ['AuthController', AuthController],
];

/**
 * Route handlers only.
 *
 * `getOwnPropertyNames` also returns private helpers — TypeScript's `private` is
 * compile-time only and nothing survives to the prototype. Nest stamps a `path`
 * on every method it routes, which is the same thing the router reads, so that is
 * what distinguishes a handler from a helper here.
 */
const handlersOf = (C: Ctor): string[] =>
  Object.getOwnPropertyNames(C.prototype)
    .filter((n) => n !== 'constructor')
    .filter((n) => {
      const fn = (C.prototype as unknown as Record<string, unknown>)[n];
      return typeof fn === 'function' && Reflect.getMetadata('path', fn as object) !== undefined;
    });

const capabilityOf = (C: Ctor, name: string): Capability | undefined => {
  const fn = (C.prototype as unknown as Record<string, unknown>)[name];
  return Reflect.getMetadata(CAPABILITY_KEY, fn as object) as Capability | undefined;
};

const isPublic = (C: Ctor, name: string): boolean => {
  const fn = (C.prototype as unknown as Record<string, unknown>)[name];
  return Reflect.getMetadata(PUBLIC_KEY, fn as object) === true;
};

/** Every *.controller.ts under src, found rather than remembered. */
function controllerFilesOn(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) controllerFilesOn(full, found);
    else if (entry.endsWith('.controller.ts')) found.push(entry.replace('.controller.ts', ''));
  }
  return found;
}

describe('the controller list', () => {
  it('covers every controller on disk', () => {
    const onDisk = controllerFilesOn(path.join(__dirname, '..', 'src')).sort();
    const listed = CONTROLLERS.map(([n]) =>
      n
        .replace(/Controller$/, '')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase(),
    ).sort();
    expect(
      onDisk,
      'a controller exists that this test does not check — add it to CONTROLLERS',
    ).toEqual(listed);
  });
});

describe('every route', () => {
  for (const [name, C] of CONTROLLERS) {
    describe(name, () => {
      const handlers = handlersOf(C);

      it('has at least one handler', () => {
        expect(handlers.length).toBeGreaterThan(0);
      });

      it('declares a capability, or is explicitly public', () => {
        for (const h of handlers) {
          const cap = capabilityOf(C, h);
          const pub = isPublic(C, h);
          expect(
            cap !== undefined || pub,
            `${name}.${h} declares neither a capability nor @Public — it would be denied at runtime`,
          ).toBe(true);
          if (cap !== undefined) expect(CAPABILITIES).toContain(cap);
        }
      });
    });
  }

  /**
   * Public handlers are listed here, each with the reason it may be reached
   * without an actor. Any OTHER public route is an unguarded hole, so the exact
   * set is asserted — adding one has to be a deliberate edit to this list.
   *
   *  - `DevStorageController.put` — a presigned URL carries its own authority,
   *    which is what presigned means. The authority is the content hash: the key
   *    names the bytes, bytes that do not hash to it are refused, and the handler
   *    answers 404 unless storage is the local filesystem.
   *
   *  - `AuthController.mode` — says whether this build uses passwords at all, so
   *    the screen knows what to render before anyone has signed in. It reveals
   *    one boolean about the configuration and nothing about who exists.
   *
   *  - `AuthController.login` — the way in. It cannot require an actor, because
   *    establishing one is its whole purpose. It is throttled per account and
   *    answers every failure identically.
   *
   *  - `AuthController.logout` — public so that a caller whose session has already
   *    expired can still be rid of the cookie. Requiring a valid session to sign
   *    out would leave a stale cookie in the browser of the person most likely to
   *    want it gone.
   */
  it('is public only where it is written down, and nowhere else', () => {
    const publics = CONTROLLERS.flatMap(([name, C]) =>
      handlersOf(C)
        .filter((h) => isPublic(C, h))
        .map((h) => `${name}.${h}`),
    );
    expect(publics.sort()).toEqual(
      ['AuthController.login', 'AuthController.logout', 'AuthController.mode', 'DevStorageController.put'].sort(),
    );
  });

  /**
   * Nothing that changes a document may be public, whatever else is added. The
   * list above is maintained by hand; this holds even if someone forgets.
   */
  it('never makes a write route public', () => {
    for (const [name, C] of CONTROLLERS) {
      for (const h of handlersOf(C)) {
        if (!isPublic(C, h)) continue;
        expect(
          ['DevStorageController', 'AuthController'].includes(name),
          `${name}.${h} is public but is not an auth or presigned-storage route`,
        ).toBe(true);
      }
    }
  });

  /** Reads and writes use capabilities of the matching kind. */
  it('does not ask for a read capability to change something', () => {
    const writeOnly: Capability[] = [
      'project.create',
      'project.edit',
      'document.create',
      'document.edit',
      'document.finalize',
      'document.approve',
      'document.reject',
      'document.void',
      'document.archive',
      'slot.waive',
      'recyclebin.purge',
    ];
    // Every capability a controller asks for is either a read or a write we know.
    for (const [name, C] of CONTROLLERS) {
      for (const h of handlersOf(C)) {
        const cap = capabilityOf(C, h);
        if (cap === undefined) continue;
        expect(
          /\.read$/.test(cap) || writeOnly.includes(cap),
          `${name}.${h} asks for ${cap}, which is neither a read nor a known write`,
        ).toBe(true);
      }
    }
  });

  /**
   * The routes have to be reachable by someone once roles are switched on. A
   * capability no role holds is a route nobody can ever call — a decorator typo
   * would look exactly like a deliberate lockout.
   */
  it('declares no capability that no role will ever hold', () => {
    for (const [name, C] of CONTROLLERS) {
      for (const h of handlersOf(C)) {
        const cap = capabilityOf(C, h);
        if (cap === undefined) continue;
        const holders = (ROLES as readonly Role[]).filter((r) => INTENDED[r].includes(cap));
        expect(holders.length, `${name}.${h} needs ${cap}, which no role holds`).toBeGreaterThan(0);
      }
    }
  });

  it('is reachable by the seeded admin operator', () => {
    for (const [, C] of CONTROLLERS) {
      for (const h of handlersOf(C)) {
        const cap = capabilityOf(C, h);
        if (cap === undefined) continue;
        expect(resolve('admin', cap, 'password').permitted).toBe(true);
      }
    }
  });

  it('refuses a viewer anything beyond the register', () => {
    expect(resolve('viewer', 'audit.read', 'password').permitted).toBe(false);
    expect(resolve('viewer', 'register.read', 'password').permitted).toBe(true);
    expect(resolve('viewer', 'document.create', 'password').permitted).toBe(false);
    expect(resolve('viewer', 'slot.waive', 'password').permitted).toBe(false);
  });

  /**
   * The lifecycle's own rules stay in the transition table, not in the URL space.
   *
   * `POST /documents/:id/transition` asks only for `document.edit`; which moves
   * are actually permitted is decided by `transition()`, which checks the
   * capability that particular move requires on top of this one. If a route ever
   * appears that names a state, the two will have started to drift.
   */
  it('has no route that names a lifecycle state', () => {
    const named = handlersOf(DocumentsController).filter((h) =>
      /^(finalize|sign|approve|void|archive|reject|draft)$/i.test(h),
    );
    expect(named, 'the transition table is the only place the lifecycle is written down').toEqual([]);
  });
});
