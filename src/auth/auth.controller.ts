/**
 * Signing in and out.
 *
 * Three rules govern everything here.
 *
 * **A failed login says one thing.** Wrong password, no such account, disabled,
 * locked — all answer with the same message and the same status. The difference
 * is recorded for the throttle, never returned, because a login page that
 * distinguishes them is a tool for discovering which addresses are real.
 *
 * **The audit chain is not writable by strangers.** Successful sign-in and
 * sign-out are recorded; failed attempts are not. The trail is append-only and
 * hash-chained, and an unauthenticated endpoint that appends to it would let
 * anyone on the internet inflate the evidentiary record of a document-control
 * system. Failures are counted on the account, which is where the defence is.
 *
 * **A new session replaces the old one.** Signing in again ends the previous
 * session rather than accumulating them, so "end my sessions" means something.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public, RequiresCapability, type PolicyRequest } from '../policy/policy.guard';
import { AllowsTemporaryPassword } from './password-change.guard';
import { UsersRepository } from './users.repository';
import { SessionsRepository } from './sessions.repository';
import { clearedCookieOptions, readCookie, SESSION_COOKIE, sessionCookieOptions } from './cookies';
import { assertUsablePassword } from './password';
import type { Env } from '../config/env';
import { ENV } from '../config/env.token';
import { AuditRepository } from '../audit/audit.repository';
import { sessionActor } from '../operator/operator';

/** What a caller is told when a sign-in does not succeed, whatever the reason. */
const REFUSED = 'That email and password do not match an account.';

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

interface ChangeBody {
  currentPassword?: unknown;
  newPassword?: unknown;
}

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Whether this build even uses passwords, so the screen knows what to render
   * before anyone has signed in. Deliberately says nothing about who exists.
   */
  @Get('mode')
  @Public()
  mode(): { authMode: Env['AUTH_MODE'] } {
    return { authMode: this.env.AUTH_MODE };
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  async login(
    @Body() body: LoginBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: { id: string; name: string; email: string; role: string }; mustChangePassword: boolean }> {
    if (this.env.AUTH_MODE !== 'password') {
      throw new BadRequestException('This build does not use passwords; every request is the seeded operator.');
    }

    const email = asString(body?.email).trim();
    const password = asString(body?.password);
    if (!email || !password) throw new UnauthorizedException(REFUSED);

    const outcome = await this.users.attemptLogin(email, password);
    if (!outcome.ok) {
      // One message for every reason. See the note at the top of this file.
      throw new UnauthorizedException(REFUSED);
    }

    // One live session per person: signing in again ends the last one.
    await this.sessions.revokeAllFor(outcome.user.id);

    const { token, session } = await this.sessions.open(outcome.user.id, {
      userAgent: req.headers['user-agent'] ?? null,
      ip: req.ip ?? null,
    });

    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(this.cookieSecure(), session.expiresAt));

    await this.audit.append(
      {
        action: 'user.signed_in',
        subjectType: 'user',
        subjectId: outcome.user.id,
        detail: { sessionId: session.id, rehashed: outcome.rehashed },
      },
      sessionActor({
        userId: outcome.user.id,
        email: outcome.user.email,
        name: outcome.user.name,
        role: outcome.user.role,
      }),
    );

    return {
      user: {
        id: outcome.user.id,
        name: outcome.user.name,
        email: outcome.user.email,
        role: outcome.user.role,
      },
      mustChangePassword: outcome.user.mustChangePassword,
    };
  }

  /**
   * Sign out.
   *
   * Public, and idempotent. A caller whose session has already expired still has
   * a cookie to be rid of, and refusing them would leave it in place.
   */
  @Post('logout')
  @Public()
  @HttpCode(200)
  async logout(@Req() req: Request & PolicyRequest, @Res({ passthrough: true }) res: Response): Promise<{ ok: true }> {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (token) {
      const who = await this.sessions.resolve(token).catch(() => null);
      if (who) {
        await this.sessions.revoke(who.sessionId);
        await this.audit.append(
          { action: 'user.signed_out', subjectType: 'user', subjectId: who.userId, detail: { sessionId: who.sessionId } },
          sessionActor(who),
        );
      }
    }
    res.clearCookie(SESSION_COOKIE, clearedCookieOptions(this.cookieSecure()));
    return { ok: true };
  }

  /** Who the caller is. The screen's first question on every load. */
  @Get('me')
  @RequiresCapability('register.read')
  @AllowsTemporaryPassword()
  me(@Req() req: Request & PolicyRequest): {
    user: { id: string; name: string; email: string; role: string };
    mustChangePassword: boolean;
    authMode: Env['AUTH_MODE'];
  } {
    const actor = req.actor!;
    return {
      user: { id: actor.id, name: actor.name, email: actor.email, role: actor.role },
      mustChangePassword: req.mustChangePassword === true,
      authMode: this.env.AUTH_MODE,
    };
  }

  /**
   * Change your own password.
   *
   * The current one is required even though the session already proves identity:
   * it is what stops an unattended browser from being used to take the account
   * over permanently. Every other session ends, because a password change is
   * exactly when someone else's stolen session should stop working.
   */
  @Post('change-password')
  @RequiresCapability('register.read')
  @AllowsTemporaryPassword()
  @HttpCode(200)
  async changePassword(
    @Body() body: ChangeBody,
    @Req() req: Request & PolicyRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const actor = req.actor!;
    const current = asString(body?.currentPassword);
    const next = asString(body?.newPassword);

    const outcome = await this.users.attemptLogin(actor.email, current);
    if (!outcome.ok) throw new UnauthorizedException('Your current password is not right.');

    if (next === current) throw new BadRequestException('The new password must be different from the current one.');
    assertUsablePassword(next, { email: actor.email, name: actor.name });

    await this.users.setPassword(actor.id, next, { mustChange: false });
    await this.sessions.revokeAllFor(actor.id);

    await this.audit.append(
      { action: 'user.password_changed', subjectType: 'user', subjectId: actor.id, detail: {} },
      actor,
    );

    // The session that made the change ended with the rest; issue a fresh one so
    // the person is not signed out by their own good behaviour.
    const { token, session } = await this.sessions.open(actor.id, {
      userAgent: req.headers['user-agent'] ?? null,
      ip: req.ip ?? null,
    });
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(this.cookieSecure(), session.expiresAt));

    return { ok: true };
  }

  /**
   * Secure unless explicitly turned off, and `loadEnv` refuses to let it be off
   * in production. The default matters: a missing setting must not silently
   * produce a cookie that travels in the clear.
   */
  private cookieSecure(): boolean {
    if (this.env.SESSION_COOKIE_SECURE !== undefined) return this.env.SESSION_COOKIE_SECURE;
    return this.env.NODE_ENV === 'production';
  }
}
