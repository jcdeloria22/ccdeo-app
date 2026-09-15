-- Office reference data the Document Builder prints from.
--
-- Signatories and extra holidays are not preferences. A signatory name is what
-- appears on an issued resolution, and a proclaimed non-working day changes the
-- working-day schedule the notice dates are calculated from. Kept in one
-- browser's localStorage they would be lost on a cleared cache and invisible to
-- anyone else, having already gone out on paper.
--
-- So they live here, and every change is audited. The value is JSON because the
-- shapes differ — a signatory block is an object, the holidays are a list — and
-- inventing a column per setting would mean a migration every time the Builder
-- learns a new one.

create table if not exists app_settings (
  key             text primary key check (length(btrim(key)) > 0),
  value           jsonb not null,
  updated_at      timestamptz not null default now(),
  updated_by      text not null,
  updated_by_role text not null
);

grant select, insert, update on app_settings to dpwh_app;
