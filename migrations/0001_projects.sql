-- DC-02: projects, with the duplicate guard enforced by the database.
--
-- The guard is a unique constraint on a NORMALISED key, not application logic.
-- Two reasons: application-level "does it already exist?" checks race each other,
-- and the real-world identifier arrives with inconsistent punctuation and case
-- ("26HH0025", "26hh0025", "26-HH-0025" are one contract, not three).

create table if not exists projects (
  id                uuid primary key default gen_random_uuid(),

  -- as the operator typed it, preserved for display
  contract_id       text not null check (length(btrim(contract_id)) > 0),

  -- what uniqueness is actually judged on
  contract_key      text generated always as (
                      upper(regexp_replace(contract_id, '[^A-Za-z0-9]', '', 'g'))
                    ) stored,

  name              text not null check (length(btrim(name)) > 0),
  location          text,

  created_at        timestamptz not null default now(),

  -- every write records an actor AND the role the act was performed under
  created_by        text not null,
  created_by_role   text not null,

  constraint projects_contract_key_unique unique (contract_key)
);

create index if not exists projects_created_at_idx on projects (created_at desc);
