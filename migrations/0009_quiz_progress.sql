-- Study progress for the ME and PE reviewers.
--
-- Kept per person and per bank rather than in one browser. The standalone
-- reviewers used localStorage, which is right for a file you double-click and
-- wrong once there is a server: clearing a cache should not erase months of
-- revision, and the same person at a different machine is still the same person.
--
-- The whole state is one JSON document. It is a score sheet — counters, topic
-- tallies, a rolling history, the list of questions missed — read and written as
-- a unit and never queried field by field, so columns would buy nothing and cost
-- a migration every time a badge is added.
--
-- Deliberately NOT audited. The audit trail is for acts on documents; how someone
-- did on a practice set is nobody's evidence of anything.

create table if not exists quiz_progress (
  actor_id   text not null,
  bank       text not null check (bank in ('me', 'pe')),
  state      jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (actor_id, bank)
);

grant select, insert, update, delete on quiz_progress to dpwh_app;
