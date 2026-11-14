-- 0005_store_fixes.sql — Brief 103 Part 1: the store findings left open by the Brief 102 QA
-- (docs/audit/102a/qa_report.md: M4, M6, L2, L6). Project: "NZA Sim (dev)", ref jbjxduathkklruvbmeho. Applies after
-- 0004. Never NZA Decoded or NZA Decoded Test.

-- ─── QA M4: projects and buildings are found by the local project's id, never by name ──────────────────────
-- local_ref is the local tool's project id (a uuid in its SQLite store; scripts use a 'fixture:…' or 'test:…' key).
-- Unique per organisation for projects and per project for buildings, so two concurrent first saves cannot make
-- duplicates. Nulls are distinct, so rows saved before 0005 stay valid until a save adopts them.

alter table public.projects  add column local_ref text check (char_length(local_ref) between 1 and 120);
alter table public.buildings add column local_ref text check (char_length(local_ref) between 1 and 120);
create unique index projects_local_ref  on public.projects  (org_id, local_ref);
create unique index buildings_local_ref on public.buildings (project_id, local_ref);
comment on column public.projects.local_ref is
  'Brief 103 P1 (QA M4): the local tool''s project id. Saves find the project by it, never by name; a rename keeps '
  'the history. Null for a project saved before 0005 until its next save adopts it.';
comment on column public.buildings.local_ref is
  'Brief 103 P1 (QA M4): the local tool''s project id (one building per local project today).';

-- Returns the building for this local project, creating the project and building if needed. A project and
-- building saved before 0005 with the same name and no local_ref are adopted once, so their versions carry on.
-- The names follow the local name (a rename updates them; the id is what matches).
create or replace function public.ensure_local_building(p_org uuid, p_local_ref text, p_name text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := public.require_caller();
  nm  text := coalesce(nullif(trim(p_name), ''), 'Untitled building');
  ref text := trim(p_local_ref);
  proj uuid;
  bld  uuid;
begin
  if ref is null or char_length(ref) not between 1 and 120 then
    raise exception 'a local project id (1 to 120 characters) is required' using errcode = '22023';
  end if;
  if char_length(nm) > 200 then
    raise exception 'the project name is longer than 200 characters' using errcode = '22023';
  end if;
  if not public.can_edit_org(p_org) then
    raise exception 'only an editor or admin can save a model version' using errcode = '42501';
  end if;

  select id into proj from public.projects where org_id = p_org and local_ref = ref;
  if proj is null then
    update public.projects set local_ref = ref
     where id = (select id from public.projects
                  where org_id = p_org and local_ref is null and name = nm order by created_at limit 1)
       and local_ref is null
    returning id into proj;
  end if;
  if proj is null then
    insert into public.projects (org_id, name, created_by, local_ref) values (p_org, nm, uid, ref)
    on conflict (org_id, local_ref) do nothing returning id into proj;
    if proj is null then
      select id into proj from public.projects where org_id = p_org and local_ref = ref;
    end if;
  end if;

  select id into bld from public.buildings where project_id = proj and local_ref = ref;
  if bld is null then
    update public.buildings set local_ref = ref
     where id = (select id from public.buildings
                  where project_id = proj and local_ref is null order by created_at limit 1)
       and local_ref is null
    returning id into bld;
  end if;
  if bld is null then
    insert into public.buildings (project_id, name, local_ref) values (proj, nm, ref)
    on conflict (project_id, local_ref) do nothing returning id into bld;
    if bld is null then
      select id into bld from public.buildings where project_id = proj and local_ref = ref;
    end if;
  end if;

  update public.projects  set name = nm where id = proj and name <> nm;
  update public.buildings set name = nm where id = bld  and name <> nm;
  return bld;
end
$$;

-- ─── QA M6: a library version is immutable; a different body for an existing version is refused ────────────
create or replace function public.upsert_library_item(
  p_org uuid, p_kind text, p_key text, p_version int, p_body jsonb, p_provenance jsonb)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := public.require_caller();
  existing uuid;
  existing_body jsonb;
  new_id uuid;
begin
  if p_org is null then
    if not public.is_nza_team() then
      raise exception 'only the NZA team can write global library items' using errcode = '42501';
    end if;
  elsif not public.is_admin_of(p_org) then
    raise exception 'only an admin can write this organisation''s library items' using errcode = '42501';
  end if;
  select id, body into existing, existing_body from public.library_items
   where coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_org, '00000000-0000-0000-0000-000000000000'::uuid)
     and kind = p_kind and key = p_key and version = p_version;
  if found then
    if existing_body is distinct from p_body then
      raise exception '% "%" version % already exists with a different body; library versions never change, save it as version %',
        p_kind, p_key, p_version, p_version + 1 using errcode = '23505';
    end if;
    return existing;
  end if;
  insert into public.library_items (org_id, kind, key, version, body, provenance, created_by)
  values (p_org, p_kind, p_key, p_version, p_body, p_provenance, uid)
  returning id into new_id;
  return new_id;
end
$$;

-- ─── QA L2: the internal helpers answer only for organisations the caller can read ─────────────────────────
-- The RLS policies on buildings, model_versions and runs call org_of_* as the querying role, so EXECUTE cannot be
-- revoked. Instead each returns null unless the caller can read the organisation it would name. Every caller is
-- can_read_org(org_of_…) or can_edit_org(org_of_…), and both are false for null, so behaviour for permitted callers
-- is unchanged and an outsider learns nothing.
create or replace function public.org_of_project(p uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$ select org_id from public.projects where id = p and public.can_read_org(org_id) $$;

create or replace function public.org_of_building(b uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.org_id from public.buildings bd join public.projects p on p.id = bd.project_id
   where bd.id = b and public.can_read_org(p.org_id)
$$;
-- org_of_version goes through org_of_building, so it is gated too.

-- admin_count is only called inside security-definer functions (set_member_role, remove_member), never by a policy
-- or the app, so it needs no grant. role_in answers only the caller's own role, so it stays.
revoke execute on function public.admin_count(uuid) from authenticated;

-- ─── QA L6: an admin can revoke an unused invitation ───────────────────────────────────────────────────────
create or replace function public.revoke_invitation(p_invitation uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  inv public.invitations;
begin
  perform public.require_caller();
  select * into inv from public.invitations where id = p_invitation;
  if not found or not public.is_admin_of(inv.org_id) then
    raise exception 'no such invitation, or only an admin of its organisation can revoke it' using errcode = '42501';
  end if;
  if inv.used_at is not null then
    raise exception 'this invitation has already been accepted; remove the member instead' using errcode = '23514';
  end if;
  update public.invitations set revoked_at = coalesce(revoked_at, now()) where id = p_invitation;
end
$$;

revoke all on function public.ensure_local_building(uuid, text, text), public.revoke_invitation(uuid)
  from public, anon, authenticated;
grant execute on function public.ensure_local_building(uuid, text, text), public.revoke_invitation(uuid)
  to authenticated;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261115000005', '0005_store_fixes') on conflict do nothing;
