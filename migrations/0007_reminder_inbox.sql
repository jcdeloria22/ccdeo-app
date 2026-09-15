-- DC-10b: the reminder inbox.
--
-- Reminders were recorded but had nowhere to be read. Delivery is an in-app
-- space rather than email — decided 15 September 2026 — which suits a build that
-- deliberately handles no credentials: there is no mail server to configure and
-- no secret to leak.
--
-- Read state lives in its own table because `reminders` is append-only and
-- guarded by a trigger. Marking something read is a new fact about an old event,
-- not an edit to it, so it is recorded as an event of its own. That also keeps
-- the answer to "who saw this, and when" available rather than collapsed into a
-- boolean.

create table if not exists reminder_acknowledgements (
  id            uuid primary key default gen_random_uuid(),
  reminder_id   uuid not null references reminders (id) on delete cascade,
  actor_id      text not null,
  actor_role    text not null,
  acknowledged_at timestamptz not null default now(),

  -- One acknowledgement per person per reminder. Clicking twice is not two facts.
  constraint reminder_acknowledgements_once unique (reminder_id, actor_id)
);

create index if not exists reminder_acks_reminder_idx on reminder_acknowledgements (reminder_id);

create or replace function reminder_acks_append_only() returns trigger as $$
begin
  raise exception 'reminder_acknowledgements is append-only (attempted %)', tg_op;
end;
$$ language plpgsql;

drop trigger if exists reminder_acks_no_change on reminder_acknowledgements;
create trigger reminder_acks_no_change
  before update on reminder_acknowledgements
  for each row execute function reminder_acks_append_only();

grant select, insert on reminder_acknowledgements to dpwh_app;
