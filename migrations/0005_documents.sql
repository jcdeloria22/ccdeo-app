-- DC-07 / DC-08: documents, their lifecycle, and approval as the signature event.
--
--   > Age is measured per state, from the transition timestamp, and resets on
--   > every transition. Never age-since-creation.
--
-- Hence `state_since`, updated on every transition. Age-since-creation would make
-- a document that moved briskly through four states look as stale as one that has
-- sat untouched, which is the opposite of what an ageing panel is for.
--
--   > Signed means approved. There is no signature artifact. A document reaches
--   > Signed when the designated approver accepts the frozen Final version, and
--   > the approval record is bound to that version's content hash.
--
-- So `approvals` stores the hash it approved. If the content later differs, the
-- approval demonstrably does not cover it.

create table if not exists documents (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references projects (id) on delete cascade,
  slot_code        text not null,
  title            text not null check (length(btrim(title)) > 0),

  state            text not null default 'Draft'
                     check (state in ('Draft','In Review','Final','Signed','Archived','Superseded','Void')),

  -- age is per state, not since creation
  state_since      timestamptz not null default now(),

  -- the upload whose bytes this document is; frozen when finalized
  upload_id        uuid references uploads (id),
  content_hash     text,

  superseded_by    uuid references documents (id),

  created_at       timestamptz not null default now(),
  created_by       text not null,
  created_by_role  text not null,

  -- a frozen document must know what it froze
  constraint documents_final_has_hash check (
    state not in ('Final','Signed','Archived') or content_hash is not null
  )
);

create index if not exists documents_project_idx on documents (project_id, slot_code);
create index if not exists documents_state_idx on documents (state, state_since);

-- Every transition is recorded. This is the SLA clock and the history.
create table if not exists document_transitions (
  id            bigserial primary key,
  document_id   uuid not null references documents (id) on delete cascade,
  from_state    text,
  to_state      text not null,
  reason        text,
  content_hash  text,
  actor_id      text not null,
  actor_role    text not null,
  occurred_at   timestamptz not null default now()
);

create index if not exists document_transitions_doc_idx on document_transitions (document_id, id);

-- The signature event. One approval per document version, bound to its hash.
create table if not exists approvals (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references documents (id) on delete cascade,
  content_hash  text not null,
  approver_id   text not null,
  approver_role text not null,
  approved_at   timestamptz not null default now(),
  constraint approvals_one_per_version unique (document_id, content_hash)
);

-- Transitions are history: append only, like the audit trail.
create or replace function document_transitions_append_only() returns trigger as $$
begin
  raise exception 'document_transitions is append-only (attempted %)', tg_op;
end;
$$ language plpgsql;

drop trigger if exists document_transitions_no_change on document_transitions;
create trigger document_transitions_no_change
  before update or delete on document_transitions
  for each row execute function document_transitions_append_only();

-- Approval is impossible from any state but Final, whatever the caller believes.
create or replace function approvals_only_from_final() returns trigger as $$
declare s text;
begin
  select state into s from documents where id = new.document_id;
  if s is distinct from 'Final' then
    raise exception 'approval requires the document to be Final (it is %)', coalesce(s, 'missing')
      using hint = 'Approval accepts a frozen Final version. Finalize it first.';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists approvals_state_gate on approvals;
create trigger approvals_state_gate
  before insert on approvals
  for each row execute function approvals_only_from_final();

-- DC-06's scan gate, at the other door.
--
-- The gate stops a non-clean upload filling a slot. Freezing the same bytes into
-- a Final document would get them past it by another route, so the frozen states
-- require the upload behind them to have an explicit Clean verdict. A scanner
-- error is not a pass here either.
create or replace function documents_frozen_content_is_clean() returns trigger as $$
declare s text;
begin
  if new.state not in ('Final','Signed','Archived') then
    return new;
  end if;
  select scan_state into s from uploads where id = new.upload_id;
  if s is distinct from 'Clean' then
    raise exception 'cannot freeze content that is % into state %', coalesce(s, 'missing'), new.state
      using hint = 'The scan gate admits an explicit Clean verdict only.';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists documents_clean_content on documents;
create trigger documents_clean_content
  before insert or update of state, upload_id on documents
  for each row execute function documents_frozen_content_is_clean();

grant select, insert, update on documents            to dpwh_app;
grant select, insert         on document_transitions to dpwh_app;
grant select, insert         on approvals            to dpwh_app;
grant usage, select on sequence document_transitions_id_seq to dpwh_app;
