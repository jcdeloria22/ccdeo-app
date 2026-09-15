-- DC-10: the reminder record.
--
-- A reminder is a thing that happened, so this table is append-only like the
-- audit trail and the transition log. It is also what makes the engine safe to
-- run on a schedule: the unique key IS the deduplication rule, enforced by the
-- database rather than by the engine remembering what it did.
--
-- The key includes `state_since`. A document that goes back to Draft and returns
-- to Final has a new clock and deserves a new reminder; one that has merely sat
-- still does not. Without `state_since` in the key, re-entering a state would be
-- silently un-remindable forever.

create table if not exists reminders (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references documents (id) on delete cascade,
  state        text not null,
  state_since  timestamptz not null,
  level        text not null check (level in ('warning', 'overdue')),
  age_days     numeric(10, 3) not null check (age_days >= 0),
  reason       text not null,
  created_at   timestamptz not null default now(),

  constraint reminders_once unique (document_id, state, state_since, level)
);

create index if not exists reminders_document_idx on reminders (document_id, created_at);

create or replace function reminders_append_only() returns trigger as $$
begin
  raise exception 'reminders is append-only (attempted %)', tg_op;
end;
$$ language plpgsql;

drop trigger if exists reminders_no_change on reminders;
create trigger reminders_no_change
  before update or delete on reminders
  for each row execute function reminders_append_only();

grant select, insert on reminders to dpwh_app;
