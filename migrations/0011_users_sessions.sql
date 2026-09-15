-- Authentication: real accounts, real sessions.
--
-- Until now a single seeded operator was every request, which is safe on
-- loopback and catastrophic anywhere else — `src/config/bind-guard.ts` refuses to
-- listen on a routable address while that is true. This is what lets the guard
-- pass, so it is also what stands between the register and the open internet.
--
-- Two tables and the reasoning behind each column that is not obvious.

create table if not exists users (
  id                    uuid primary key default gen_random_uuid(),

  -- As typed, for display and for the person to recognise. Uniqueness is judged
  -- case-insensitively below: "Jayz@example.com" and "jayz@example.com" are one
  -- account, and letting them be two is how a person locks themselves out.
  email                 text not null check (position('@' in email) > 1),
  name                  text not null check (length(btrim(name)) > 0),

  -- The role every act of this user is performed under. Same vocabulary as
  -- src/policy/roles.ts; the check is here so a typo cannot create a role that
  -- silently matches no policy rule and therefore grants nothing — or, worse,
  -- one the guard has no opinion about.
  role                  text not null check (role in
                          ('admin', 'materials_engineer', 'approver', 'project_engineer', 'viewer')),

  -- scrypt$N$r$p$salt$hash. Never a password, never reversible, and carrying the
  -- parameters it was made with so the cost can be raised without a reset.
  password_hash         text not null,

  -- Set when an administrator issues a password. The session is created but the
  -- user can do nothing else until it is changed, so an admin never keeps
  -- knowledge of a working credential.
  must_change_password  boolean not null default false,

  -- Disabled rather than deleted. A user who signed documents cannot be removed
  -- without orphaning the audit trail that names them.
  disabled_at           timestamptz,

  -- Throttling, held here rather than in memory so it survives a restart and is
  -- shared across instances. A public login page without this is a free oracle.
  failed_attempts       integer not null default 0 check (failed_attempts >= 0),
  locked_until          timestamptz,
  last_login_at         timestamptz,

  created_at            timestamptz not null default now(),
  created_by            text not null,
  created_by_role       text not null,
  updated_at            timestamptz not null default now()
);

-- Uniqueness on the normalised address, for the reason given above.
create unique index if not exists users_email_unique on users (lower(email));
create index if not exists users_role_idx on users (role);

create table if not exists sessions (
  id            uuid primary key default gen_random_uuid(),

  -- The SHA-256 of the cookie value, never the value itself. A leaked database
  -- then yields no usable session: the same reasoning as not storing passwords.
  token_hash    text not null,

  user_id       uuid not null references users (id) on delete cascade,

  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),

  -- Absolute expiry. Idle timeout is applied against last_seen_at in code, so
  -- both limits exist: a session dies of old age and of neglect.
  expires_at    timestamptz not null,

  -- Sign-out, and administrative revocation. Kept rather than deleted so that
  -- "this session was ended at this time" remains answerable.
  revoked_at    timestamptz,

  -- What the session was opened from. Enough to recognise a session you do not
  -- recognise; deliberately not a fingerprint.
  user_agent    text,
  ip            text
);

create unique index if not exists sessions_token_hash_unique on sessions (token_hash);
create index if not exists sessions_user_idx on sessions (user_id, created_at desc);
-- Expired-session cleanup scans on this.
create index if not exists sessions_expires_idx on sessions (expires_at);

grant select, insert, update, delete on users to dpwh_app;
grant select, insert, update, delete on sessions to dpwh_app;
