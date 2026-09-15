-- DC-04: append-only, hash-chained audit.
--
--   > Audit is append-only. Hash-chained via prev_hash; the application database
--   > role holds INSERT only on audit_events. Deleting a document never removes
--   > its audit events.
--
-- Three mechanisms, deliberately overlapping:
--
--   1. GRANTs. The application connects as dpwh_app, which has INSERT and SELECT
--      on audit_events and nothing else. A bug that tries to rewrite history is
--      refused by the server, not by a code review.
--
--   2. A trigger, so even a role that *was* granted UPDATE or DELETE is refused.
--      Grants are easy to widen by accident; this is not.
--
--   3. The hash chain, so that tampering through any route that bypasses both —
--      a restored dump, a superuser, direct file edits — is still detectable.
--
-- subject_id is deliberately plain text with NO foreign key: deleting a document
-- must never cascade into its audit trail.

create table if not exists audit_events (
  id            bigserial primary key,
  occurred_at   timestamptz not null default now(),

  -- every act records who, and the role it was performed under
  actor_id      text not null,
  actor_role    text not null,

  action        text not null,
  subject_type  text not null,
  subject_id    text,
  detail        jsonb not null default '{}'::jsonb,

  prev_hash     text,
  hash          text not null unique
);

create index if not exists audit_events_subject_idx on audit_events (subject_type, subject_id, id);
create index if not exists audit_events_occurred_idx on audit_events (occurred_at desc);

-- 2. refuse rewriting, whatever the grants say
create or replace function audit_events_append_only() returns trigger as $$
begin
  raise exception 'audit_events is append-only (attempted %)', tg_op
    using hint = 'Audit history is never edited. Record a new event instead.';
end;
$$ language plpgsql;

drop trigger if exists audit_events_no_update on audit_events;
create trigger audit_events_no_update
  before update or delete on audit_events
  for each row execute function audit_events_append_only();

-- 1. the application role
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'dpwh_app') then
    -- No password: this cluster is loopback-only with trust auth, the same
    -- reasoning the application's bind guard uses. A hosted deployment must
    -- create this role with a password and real authentication.
    create role dpwh_app login;
  end if;
end $$;

grant usage on schema public to dpwh_app;

-- projects: ordinary table, ordinary rights
grant select, insert, update, delete on projects to dpwh_app;

-- audit: append and read. Never update, never delete.
grant select, insert on audit_events to dpwh_app;
revoke update, delete, truncate on audit_events from dpwh_app;
grant usage, select on sequence audit_events_id_seq to dpwh_app;

-- future tables default to nothing for dpwh_app until granted explicitly
alter default privileges in schema public revoke all on tables from dpwh_app;
