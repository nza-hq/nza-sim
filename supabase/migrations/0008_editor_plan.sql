-- 0008_editor_plan.sql — Brief 110 P4: a drawn model's Plan saves beside its document.
-- Project: "NZA Sim (dev)", ref jbjxduathkklruvbmeho. Applies after 0007. Never NZA Decoded or NZA Decoded Test.
--
-- The Plan is the Model workspace's source: blocks, rooms, zones, windows, the project's types, their names. The
-- document is what the engine reads, derived from the Plan. A version stores both, so it can be reopened in the
-- editor. The model hash, and so the run key, stays the document's alone (docs/audit/110/00_reconnaissance.md §3):
-- the Plan has its own hash, checked here the same way the document's is (sha256 of the exact text the client sent).
--
-- A drawn model is its own building under the local project ('<local id>:model'), so the versions the Systems page
-- saves (converted from today's inputs) and the drawn model's versions are separate histories.

alter table public.model_versions
  add column plan jsonb,
  add column plan_canonical text,
  add column plan_hash text check (plan_hash ~ '^[0-9a-f]{64}$');
alter table public.model_versions add constraint model_versions_plan_whole
  check ((plan is null and plan_canonical is null and plan_hash is null)
      or (plan is not null and plan_canonical is not null and plan_hash is not null));
comment on column public.model_versions.plan is
  'Brief 110: the Model workspace''s Plan this document was built from (null for versions saved without one). '
  'Not part of model_hash; plan_hash = sha256(plan_canonical).';

-- The drawn model's building for a local project: the project is found (or made) as ensure_local_building does;
-- the building is '<local id>:model', named '<name> (drawn model)'.
create or replace function public.ensure_model_building(p_org uuid, p_local_ref text, p_name text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  today_bld uuid := public.ensure_local_building(p_org, p_local_ref, p_name);
  proj uuid;
  ref  text := trim(p_local_ref) || ':model';
  nm   text := left(coalesce(nullif(trim(p_name), ''), 'Untitled building'), 186) || ' (drawn model)';
  bld  uuid;
begin
  select project_id into proj from public.buildings where id = today_bld;
  select id into bld from public.buildings where project_id = proj and local_ref = ref;
  if bld is null then
    insert into public.buildings (project_id, name, local_ref) values (proj, nm, ref)
    on conflict (project_id, local_ref) do nothing returning id into bld;
    if bld is null then
      select id into bld from public.buildings where project_id = proj and local_ref = ref;
    end if;
  else
    update public.buildings set name = nm where id = bld and name is distinct from nm;
  end if;
  return bld;
end
$$;

-- create_model_version (0004), plus the Plan, checked against its hash and stored on the same row.
create or replace function public.create_model_version_with_plan(
  p_building uuid, p_schema_version text, p_canonical text,
  p_model_hash text, p_library_hash text, p_weather_hash text,
  p_parent uuid, p_note text, p_plan_canonical text, p_plan_hash text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  computed text;
  pl jsonb;
  new_id uuid;
begin
  if p_plan_canonical is null then
    raise exception 'no plan text' using errcode = '22004';
  end if;
  computed := encode(sha256(convert_to(p_plan_canonical, 'UTF8')), 'hex');
  if computed <> p_plan_hash then
    raise exception 'plan_hash % does not match the plan text (sha256 %)', p_plan_hash, computed using errcode = '23514';
  end if;
  pl := p_plan_canonical::jsonb;
  if jsonb_typeof(pl) <> 'object' then
    raise exception 'the plan must be a JSON object' using errcode = '23514';
  end if;
  -- Every check of the document (caller's role, hash, building, schema, weather, parent) is create_model_version's.
  new_id := public.create_model_version(p_building, p_schema_version, p_canonical, p_model_hash, p_library_hash,
                                        p_weather_hash, p_parent, p_note);
  update public.model_versions set plan = pl, plan_canonical = p_plan_canonical, plan_hash = p_plan_hash where id = new_id;
  return new_id;
end
$$;

revoke all on function public.ensure_model_building(uuid, text, text),
  public.create_model_version_with_plan(uuid, text, text, text, text, text, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.ensure_model_building(uuid, text, text),
  public.create_model_version_with_plan(uuid, text, text, text, text, text, uuid, text, text, text)
  to authenticated;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261115220758', '0008_editor_plan') on conflict do nothing;
