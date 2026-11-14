-- 0002_model_store.sql — Brief 102 Part 2: the model store. Projects, buildings, immutable model
-- versions, versioned library items with provenance, and runs keyed by the four hashes.
--
-- Project: "NZA Sim (dev)", ref jbjxduathkklruvbmeho. Applies after 0001_tenancy.sql.
-- Design note 418d645e-05cc-811e-ad6b-fa8846f12148 Rev A.3: model_versions never updated (a change
-- is a new row with parent_id); runs never updated (same four hashes = the same row); a model's
-- hash is checked in SQL so a client cannot store a document under the wrong hash.

-- ─── Canonical JSON and the hash, in SQL ─────────────────────────────────────────────────────
-- Must agree byte for byte with frontend/src/thermal/schema/canonical.ts (Brief 102 Part 1):
-- object keys sorted, arrays in order, no whitespace, numbers with trailing zeros trimmed
-- (trim_scale, so 1.50 and 1.5 hash the same, as JavaScript's JSON.stringify would print them; -0 becomes 0). Part 1's tests assert the two agree on
-- the anchor fixture; if a later change breaks that agreement, create_model_version rejects every
-- save, which is the loud failure we want.
create or replace function public.canonical_json(j jsonb)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select case jsonb_typeof(j)
    when 'object' then '{' || coalesce((
        select string_agg(to_json(k)::text || ':' || public.canonical_json(v), ',' order by k)
          from jsonb_each(j) as e(k, v)), '') || '}'
    when 'array' then '[' || coalesce((
        select string_agg(public.canonical_json(v), ',' order by ord)
          from jsonb_array_elements(j) with ordinality as e(v, ord)), '') || ']'
    when 'number' then case when trim_scale((j::text)::numeric) = 0 then '0' else trim_scale((j::text)::numeric)::text end
    else j::text
  end
$$;

create or replace function public.model_hash(document jsonb)
returns text
language sql immutable
set search_path = public, pg_temp
as $$ select encode(sha256(convert_to(public.canonical_json(document), 'UTF8')), 'hex') $$;

-- ─── Tables ──────────────────────────────────────────────────────────────────────────────────

create table public.projects (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organisations (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 200),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.projects is 'Brief 102: a project belongs to one organisation; RLS reads org_id.';
create index projects_org_id on public.projects (org_id);

create table public.buildings (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects (id) on delete cascade,
  name                 text not null check (char_length(name) between 1 and 200),
  decoded_building_key text check (char_length(decoded_building_key) <= 120),
  created_at           timestamptz not null default now()
);
comment on table public.buildings is
  'Brief 102: a building in a project. decoded_building_key is decodED''s building identity (URN plus '
  'twin building id), set only through the Brief 113 link; null for a building decodED does not know.';
create index buildings_project_id on public.buildings (project_id);
create unique index buildings_decoded_key on public.buildings (project_id, decoded_building_key)
  where decoded_building_key is not null;

create table public.model_versions (
  id             uuid primary key default gen_random_uuid(),
  building_id    uuid not null references public.buildings (id) on delete cascade,
  parent_id      uuid references public.model_versions (id) on delete set null,
  schema_version text not null check (char_length(schema_version) <= 20),
  document       jsonb not null,
  model_hash     text not null check (model_hash ~ '^[0-9a-f]{64}$'),
  library_hash   text not null check (library_hash ~ '^[0-9a-f]{64}$'),
  weather_hash   text not null check (weather_hash ~ '^[0-9a-f]{64}$'),
  note           text check (char_length(note) <= 500),
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);
comment on table public.model_versions is
  'Brief 102: an immutable snapshot of a model document. Never updated; a change is a new row with '
  'parent_id. model_hash is checked against the document in create_model_version.';
create index model_versions_building_id on public.model_versions (building_id, created_at desc);
create index model_versions_model_hash on public.model_versions (model_hash);

create table public.library_items (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid references public.organisations (id) on delete cascade,
  kind       text not null check (kind in ('construction','profile','system_template','age_band_default','weather')),
  key        text not null check (char_length(key) between 1 and 120),
  version    int  not null check (version >= 1),
  body       jsonb not null,
  provenance jsonb not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.library_items is
  'Brief 102: a versioned library item. org_id null = NZA global (NZA team writes); set = that '
  'organisation''s own (its admins write). provenance records source, date and who. A model pins the '
  'versions it used in library_refs; library_hash is computed over them.';
create unique index library_items_unique
  on public.library_items (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, key, version);
create index library_items_kind_key on public.library_items (kind, key);

create table public.runs (
  id               uuid primary key default gen_random_uuid(),
  model_version_id uuid not null references public.model_versions (id) on delete cascade,
  model_hash       text not null check (model_hash ~ '^[0-9a-f]{64}$'),
  engine_version   text not null check (char_length(engine_version) between 1 and 40),
  library_hash     text not null check (library_hash ~ '^[0-9a-f]{64}$'),
  weather_hash     text not null check (weather_hash ~ '^[0-9a-f]{64}$'),
  results          jsonb not null,
  summary          jsonb not null,
  source           text not null check (char_length(source) <= 200),
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint runs_one_per_key unique (model_hash, engine_version, library_hash, weather_hash)
);
comment on table public.runs is
  'Brief 102: one result per (model_hash, engine_version, library_hash, weather_hash). Same key, same '
  'answer, forever; record_run returns the existing row on a hit. summary carries eui_kwh_m2, '
  'annual_by_end_use and annual_by_fuel; source names the canonical read path the summary came from.';
create index runs_model_version_id on public.runs (model_version_id, created_at desc);

-- ─── Ownership helpers ───────────────────────────────────────────────────────────────────────

create or replace function public.org_of_project(p uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$ select org_id from public.projects where id = p $$;

create or replace function public.org_of_building(b uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$ select p.org_id from public.buildings bd join public.projects p on p.id = bd.project_id where bd.id = b $$;

create or replace function public.org_of_version(v uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$ select public.org_of_building(building_id) from public.model_versions where id = v $$;

-- ─── Write functions ─────────────────────────────────────────────────────────────────────────

create or replace function public.create_project(p_org uuid, p_name text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := public.require_caller();
  new_id uuid;
begin
  if not public.can_edit_org(p_org) then
    raise exception 'only an editor or admin can create a project' using errcode = '42501';
  end if;
  insert into public.projects (org_id, name, created_by) values (p_org, trim(p_name), uid) returning id into new_id;
  return new_id;
end
$$;

create or replace function public.create_building(p_project uuid, p_name text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  new_id uuid;
begin
  perform public.require_caller();
  if not public.can_edit_org(public.org_of_project(p_project)) then
    raise exception 'only an editor or admin can add a building' using errcode = '42501';
  end if;
  insert into public.buildings (project_id, name) values (p_project, trim(p_name)) returning id into new_id;
  return new_id;
end
$$;

-- Stores a model version. Computes nothing but the check: the hash the client claims must equal the
-- hash of the canonical document, or the save is refused and the message names both.
create or replace function public.create_model_version(
  p_building uuid, p_schema_version text, p_document jsonb,
  p_model_hash text, p_library_hash text, p_weather_hash text,
  p_parent uuid default null, p_note text default null)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := public.require_caller();
  computed text := public.model_hash(p_document);
  new_id uuid;
begin
  if not public.can_edit_org(public.org_of_building(p_building)) then
    raise exception 'only an editor or admin can save a model version' using errcode = '42501';
  end if;
  if computed <> p_model_hash then
    raise exception 'model_hash % does not match the document (canonical sha256 %)', p_model_hash, computed
      using errcode = '23514';
  end if;
  if p_parent is not null and public.org_of_version(p_parent) is distinct from public.org_of_building(p_building) then
    raise exception 'parent version belongs to another organisation' using errcode = '42501';
  end if;
  insert into public.model_versions
    (building_id, parent_id, schema_version, document, model_hash, library_hash, weather_hash, note, created_by)
  values
    (p_building, p_parent, p_schema_version, p_document, p_model_hash, p_library_hash, p_weather_hash, p_note, uid)
  returning id into new_id;
  return new_id;
end
$$;

-- Records a run. On a hit of the four-hash key, returns the existing row's id and changes nothing.
create or replace function public.record_run(
  p_version uuid, p_engine_version text, p_results jsonb, p_summary jsonb, p_source text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := public.require_caller();
  v public.model_versions;
  existing uuid;
  new_id uuid;
begin
  select * into v from public.model_versions where id = p_version;
  if not found then
    raise exception 'no such model version' using errcode = 'P0002';
  end if;
  if not public.can_edit_org(public.org_of_building(v.building_id)) then
    raise exception 'only an editor or admin can record a run' using errcode = '42501';
  end if;
  select id into existing from public.runs
   where model_hash = v.model_hash and engine_version = p_engine_version
     and library_hash = v.library_hash and weather_hash = v.weather_hash;
  if found then
    return existing;
  end if;
  insert into public.runs
    (model_version_id, model_hash, engine_version, library_hash, weather_hash, results, summary, source, created_by)
  values
    (p_version, v.model_hash, p_engine_version, v.library_hash, v.weather_hash, p_results, p_summary, p_source, uid)
  returning id into new_id;
  return new_id;
end
$$;

-- Global items (p_org null): NZA team only. Organisation items: that organisation's admins.
-- Idempotent on (org, kind, key, version): the same row again is a no-op that returns the existing id.
create or replace function public.upsert_library_item(
  p_org uuid, p_kind text, p_key text, p_version int, p_body jsonb, p_provenance jsonb)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := public.require_caller();
  existing uuid;
  new_id uuid;
begin
  if p_org is null then
    if not public.is_nza_team() then
      raise exception 'only the NZA team can write global library items' using errcode = '42501';
    end if;
  elsif not public.is_admin_of(p_org) then
    raise exception 'only an admin can write this organisation''s library items' using errcode = '42501';
  end if;
  select id into existing from public.library_items
   where coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_org, '00000000-0000-0000-0000-000000000000'::uuid)
     and kind = p_kind and key = p_key and version = p_version;
  if found then
    return existing;
  end if;
  insert into public.library_items (org_id, kind, key, version, body, provenance, created_by)
  values (p_org, p_kind, p_key, p_version, p_body, p_provenance, uid)
  returning id into new_id;
  return new_id;
end
$$;

-- ─── RLS and grants ──────────────────────────────────────────────────────────────────────────

alter table public.projects       enable row level security;
alter table public.buildings      enable row level security;
alter table public.model_versions enable row level security;
alter table public.library_items  enable row level security;
alter table public.runs           enable row level security;

revoke all on public.projects, public.buildings, public.model_versions, public.library_items, public.runs
  from anon, authenticated;

create policy projects_member_read on public.projects for select to authenticated
  using (public.can_read_org(org_id));
create policy buildings_member_read on public.buildings for select to authenticated
  using (public.can_read_org(public.org_of_project(project_id)));
create policy model_versions_member_read on public.model_versions for select to authenticated
  using (public.can_read_org(public.org_of_building(building_id)));
create policy library_items_read on public.library_items for select to authenticated
  using (org_id is null or public.can_read_org(org_id));
create policy runs_member_read on public.runs for select to authenticated
  using (public.can_read_org(public.org_of_version(model_version_id)));

grant select on public.projects, public.buildings, public.model_versions, public.library_items, public.runs
  to authenticated;

revoke all on function public.canonical_json(jsonb), public.model_hash(jsonb),
  public.org_of_project(uuid), public.org_of_building(uuid), public.org_of_version(uuid),
  public.create_project(uuid, text), public.create_building(uuid, text),
  public.create_model_version(uuid, text, jsonb, text, text, text, uuid, text),
  public.record_run(uuid, text, jsonb, jsonb, text),
  public.upsert_library_item(uuid, text, text, int, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.canonical_json(jsonb), public.model_hash(jsonb),
  public.org_of_project(uuid), public.org_of_building(uuid), public.org_of_version(uuid),
  public.create_project(uuid, text), public.create_building(uuid, text),
  public.create_model_version(uuid, text, jsonb, text, text, text, uuid, text),
  public.record_run(uuid, text, jsonb, jsonb, text),
  public.upsert_library_item(uuid, text, text, int, jsonb, jsonb)
  to authenticated;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261114190002', '0002_model_store') on conflict do nothing;
