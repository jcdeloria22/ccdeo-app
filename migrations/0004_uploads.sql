-- DC-06: versioned uploads with a scan gate.
--
--   > Blobs are immutable and content-addressed by SHA-256. New version = new
--   > row, new hash. Never overwrite.
--
-- So an upload is never edited in place. Replacing a document is a new version
-- of that slot, and the previous version stays exactly as it was.
--
-- The gate: an upload is Quarantined until a scanner returns an explicit clean
-- verdict. Infected, an error, a timeout and "no scanner installed" all leave it
-- quarantined. A slot cannot be Filled by anything that is not Clean, and that is
-- enforced here rather than only in application code — the whole point of a gate
-- is that it does not depend on every caller remembering it.

create table if not exists uploads (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references projects (id) on delete cascade,
  slot_code        text not null,

  -- version is per (project, slot); a replacement never overwrites
  version          integer not null check (version > 0),

  filename         text not null check (length(btrim(filename)) > 0),
  content_type     text,
  size_bytes       bigint not null check (size_bytes >= 0),
  sha256           text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key      text not null,

  scan_state       text not null default 'Quarantined'
                     check (scan_state in ('Quarantined', 'Clean', 'Infected', 'ScanError')),
  scan_detail      text,
  scanner          text,
  scanned_at       timestamptz,

  uploaded_at      timestamptz not null default now(),
  uploaded_by      text not null,
  uploaded_by_role text not null,

  constraint uploads_version_unique unique (project_id, slot_code, version)
);

create index if not exists uploads_slot_idx on uploads (project_id, slot_code, version desc);

-- Immutability: the bytes an upload points at never change. Scan fields may be
-- written once the scanner reports; everything else is fixed at insert.
create or replace function uploads_immutable() returns trigger as $$
begin
  if new.sha256 is distinct from old.sha256
     or new.storage_key is distinct from old.storage_key
     or new.project_id is distinct from old.project_id
     or new.slot_code is distinct from old.slot_code
     or new.version is distinct from old.version
     or new.size_bytes is distinct from old.size_bytes then
    raise exception 'uploads are immutable — a replacement is a new version, not an edit'
      using hint = 'Insert a new upload row with the next version for this slot.';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists uploads_no_mutate on uploads;
create trigger uploads_no_mutate
  before update on uploads
  for each row execute function uploads_immutable();

-- The gate, at the database. A slot only reaches Filled if a Clean upload exists.
create or replace function project_slots_fill_requires_clean() returns trigger as $$
begin
  if new.state = 'Filled' then
    if not exists (
      select 1 from uploads u
       where u.project_id = new.project_id
         and u.slot_code  = new.slot_code
         and u.scan_state = 'Clean'
    ) then
      raise exception 'slot % cannot be Filled: no upload has passed the scan gate', new.slot_code
        using hint = 'An upload is Quarantined until a scanner returns an explicit clean verdict.';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists project_slots_fill_gate on project_slots;
create trigger project_slots_fill_gate
  before insert or update on project_slots
  for each row execute function project_slots_fill_requires_clean();

grant select, insert, update on uploads to dpwh_app;
