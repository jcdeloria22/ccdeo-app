-- DC-05: versioned slot templates.
--
-- A "slot" is a required document in a set. The set is defined by a template, and
-- the template is VERSIONED — which is the whole point of this step.
--
-- The rule that makes versioning mean something: a project's slots are copied
-- from one template version at the moment they are created, and a later version
-- never reaches back and changes them. A set that silently gained a requirement
-- after the fact would make every previous readiness figure a lie.
--
-- Templates carry provenance. me-spec-sources puts required-document sets at
-- tier 3 (the QC/QA manual and standard forms), so a template records where its
-- list came from and whether that has been verified. An unverified list is usable
-- but must never look verified.

create table if not exists slot_templates (
  id              uuid primary key default gen_random_uuid(),
  code            text not null check (length(btrim(code)) > 0),
  version         integer not null check (version > 0),
  name            text not null check (length(btrim(name)) > 0),

  -- draft -> active -> superseded. Only one active version per code.
  status          text not null default 'draft'
                    check (status in ('draft', 'active', 'superseded')),

  -- provenance, per me-spec-sources
  provisional     boolean not null default true,
  source_note     text not null default 'unverified',

  created_at      timestamptz not null default now(),
  created_by      text not null,
  created_by_role text not null,

  constraint slot_templates_code_version_unique unique (code, version)
);

-- at most one active version per template code
create unique index if not exists slot_templates_one_active
  on slot_templates (code) where status = 'active';

create table if not exists slot_template_items (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references slot_templates (id) on delete cascade,
  slot_code    text not null check (length(btrim(slot_code)) > 0),
  name         text not null check (length(btrim(name)) > 0),
  required     boolean not null default true,
  position     integer not null,
  constraint slot_template_items_unique unique (template_id, slot_code)
);

-- Slots as they exist on a project: copied from a template version and frozen.
create table if not exists project_slots (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects (id) on delete cascade,
  template_id   uuid not null references slot_templates (id),
  slot_code     text not null,
  name          text not null,
  required      boolean not null,
  position      integer not null,

  -- Waived is a slot-level branch of the lifecycle
  state         text not null default 'Pending'
                  check (state in ('Pending', 'Filled', 'Waived')),
  waived_reason text,
  waived_by     text,
  waived_at     timestamptz,

  created_at    timestamptz not null default now(),

  constraint project_slots_unique unique (project_id, slot_code),

  -- a waiver without a reason is not a waiver, it is a gap
  constraint project_slots_waiver_needs_reason check (
    state <> 'Waived' or (waived_reason is not null and length(btrim(waived_reason)) > 0)
  )
);

create index if not exists project_slots_project_idx on project_slots (project_id, position);

grant select, insert, update, delete on slot_templates      to dpwh_app;
grant select, insert, update, delete on slot_template_items  to dpwh_app;
grant select, insert, update, delete on project_slots        to dpwh_app;
