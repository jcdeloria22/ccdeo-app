/**
 * The session cookie.
 *
 * Hand-rolled rather than adding `cookie-parser`, because reading one cookie is
 * a few lines and Express can already set them. Fewer dependencies is also fewer
 * things to audit on the path between the internet and a session.
 *
 * The flags are the security properties, so they are stated here once:
 *
 *  - `HttpOnly` — script cannot read it, so an injected script cannot steal the
 *    session even if one gets in.
 *  - `SameSite=Lax` — not sent on cross-site POSTs, which is what makes CSRF
 *    against the write routes impractical without a separate token. `Strict`
 *    would be marginally safer and would also drop the cookie when arriving from
 *    an external link, which reads as a random logout.
 *  - `Secure` — HTTPS only. Configurable solely so a loopback build can sign in;
 *    `loadEnv` refuses to let it be false in production.
 *  - `Path=/` — the API and the app are one origin.
 *
 * No `Domain`, so the cookie stays on the exact host that set it rather than
 * being offered to every subdomain.
 */

export const SESSION_COOKIE = 'dpwh_session';

/** One cookie out of a `Cookie:` header. Returns null rather than throwing. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      // A malformed value is not our session; treat it as absent.
      return null;
    }
  }
  return null;
}

export interface CookieOptions {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: '/';
  maxAge?: number;
  expires?: Date;
}

export function sessionCookieOptions(secure: boolean, expiresAt: Date): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    expires: expiresAt,
  };
}

/** The same attributes with an expiry in the past, which is how a cookie is cleared. */
export function clearedCookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    expires: new Date(0),
  };
}
