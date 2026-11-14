-- 0001_tenancy.sql — Brief 102 Part 2: NZA Sim's own identity. Organisations, people, roles,
-- invitations, the empty decodED link table, and the RLS helpers every later table reads.
--
-- Project: "NZA Sim (dev)", ref jbjxduathkklruvbmeho. Never NZA Decoded, never NZA Decoded Test.
-- Pattern copied from decodED's supabase/migrations/0003_tenancy.sql and 0008_access.sql
-- (Brief 64, design note 407d645e05cc815ba5baf52435f20650) and trimmed: no schools, no trusts,
-- no URNs, no claim rules, no consents. Flat organisations; three roles; no anonymous sign-in;
-- every table RLS on in this file; nothing granted to anon; every write a security definer
-- function that checks the caller. Design note for Simulate v2: Notion
-- 418d645e-05cc-811e-ad6b-fa8846f12148, Rev A.5 (own database, own identity, link as an
-- integration).
--
-- Applied through the dashboard SQL editor on 14 Nov 2026 (the connector could not reach this
-- organisation); recorded in supabase_migrations.schema_migrations at the end of this file so the
-- CLI and the MCP agree with what is live.

-- ─── The caller ──────────────────────────────────────────────────────────────────────────────

create or replace function public.is_anonymous_caller()
returns boolean
language sql stable
set search_path = public, pg_temp
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
$$;

-- The caller's user id, or null for the anon role and for an anonymous user. Policies call it as
-- (select public.caller_id()) so Postgres evaluates it once per statement.
create or replace function public.caller_id()
returns uuid
language sql stable
set search_path = public, pg_temp
as $$
  select case when public.is_anonymous_caller() then null else auth.uid() end
$$;

create or replace function public.require_caller()
returns uuid
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := public.caller_id();
begin
  if uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  return uid;
end
$$;

-- ─── Tables ──────────────────────────────────────────────────────────────────────────────────

create table public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 120),
  created_at   timestamptz not null default now()
);
comment on table public.profiles is
  'Brief 102: a person. NZA Sim''s own; nothing here is read by any other NZA tool.';

create table public.organisations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 200),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.organisations is
  'Brief 102: a client or NZA itself. Flat: no parents. The root of every RLS policy through memberships.';

create table public.memberships (
  org_id    uuid not null references public.organisations (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  role      text not null check (role in ('admin','editor','viewer')),
  status    text not null default 'active' check (status in ('active','removed')),
  joined_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
comment on table public.memberships is
  'Brief 102: who belongs where, with what role. admin / editor / viewer. Removed members keep a row with status removed.';
create index memberships_user_id on public.memberships (user_id);

create table public.invitations (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organisations (id) on delete cascade,
  email      text not null check (char_length(email) <= 320),
  role       text not null check (role in ('admin','editor','viewer')),
  token_hash text not null unique,
  expires_at timestamptz not null default now() + interval '7 days',
  used_at    timestamptz,
  used_by    uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.invitations is
  'Brief 102: an invitation to join an organisation. Only the SHA-256 of the token is stored; the raw '
  'token is returned once by invite_member.';
create index invitations_org_id on public.invitations (org_id);

create table public.nza_team (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);
comment on table public.nza_team is
  'Brief 102: NZA staff. May write global library items and apply the decodED link on a client''s behalf. '
  'Rows are added by the owner in the dashboard, never by a function.';

create table public.org_links (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organisations (id) on delete cascade,
  decoded_org_id uuid not null,
  token_hash     text not null unique,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  revoked_at     timestamptz,
  constraint org_links_one_live_per_org unique (org_id, decoded_org_id)
);
comment on table public.org_links is
  'Brief 102 (shape) / Brief 113 (use): the optional link from an NZA Sim organisation to a decodED '
  'organisation. decodED holds only (decoded_org_id, sim_org_id, token); NZA Sim never reads decodED. '
  'Empty until Brief 113; no function writes it before then.';
create index org_links_org_id on public.org_links (org_id);

-- ─── RLS helpers ─────────────────────────────────────────────────────────────────────────────

create or replace function public.role_in(org uuid)
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select m.role
    from public.memberships m
   where m.org_id = org and m.user_id = public.caller_id() and m.status = 'active'
$$;

create or replace function public.can_read_org(org uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$ select public.role_in(org) is not null $$;

create or replace function public.can_edit_org(org uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$ select coalesce(public.role_in(org) in ('admin','editor'), false) $$;

create or replace function public.is_admin_of(org uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$ select coalesce(public.role_in(org) = 'admin', false) $$;

create or replace function public.is_nza_team()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.nza_team t where t.user_id = public.caller_id())
$$;

create or replace function public.new_token()
returns text
language sql volatile
set search_path = public, pg_temp
as $$ select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') $$;

create or replace function public.token_hash(token text)
returns text
language sql immutable
set search_path = public, pg_temp
as $$ select encode(sha256(convert_to(token, 'UTF8')), 'hex') $$;

-- ─── Write functions ─────────────────────────────────────────────────────────────────────────

-- Creates an organisation; the caller becomes its admin.
create or replace function public.create_organisation(p_name text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := public.require_caller();
  new_id uuid;
begin
  insert into public.organisations (name, created_by) values (trim(p_name), uid) returning id into new_id;
  insert into public.memberships (org_id, user_id, role) values (new_id, uid, 'admin');
  insert into public.profiles (user_id) values (uid) on conflict do nothing;
  return new_id;
end
$$;

-- Admin only. Returns the raw token once; only its hash is stored.
create or replace function public.invite_member(p_org uuid, p_email text, p_role text)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := public.require_caller();
  token text := public.new_token();
begin
  if not public.is_admin_of(p_org) then
    raise exception 'only an admin can invite' using errcode = '42501';
  end if;
  if p_role not in ('admin','editor','viewer') then
    raise exception 'role must be admin, editor or viewer' using errcode = '22023';
  end if;
  insert into public.invitations (org_id, email, role, token_hash, created_by)
  values (p_org, lower(trim(p_email)), p_role, public.token_hash(token), uid);
  return token;
end
$$;

-- Not signed in: validates only, returns the organisation id, changes nothing. Signed in with the
-- invited email: joins with the invited role and marks the invitation used.
create or replace function public.accept_invitation_token(p_token text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := public.caller_id();
  inv public.invitations;
  caller_email text := lower(auth.jwt() ->> 'email');
begin
  select * into inv from public.invitations
   where token_hash = public.token_hash(p_token)
     and used_at is null and revoked_at is null and expires_at > now();
  if not found then
    raise exception 'this invitation is not valid' using errcode = '42501';
  end if;
  if uid is null then
    return inv.org_id;
  end if;
  if caller_email is distinct from inv.email then
    raise exception 'this invitation was sent to a different email address' using errcode = '42501';
  end if;
  insert into public.memberships (org_id, user_id, role) values (inv.org_id, uid, inv.role)
  on conflict (org_id, user_id) do update set role = excluded.role, status = 'active', joined_at = now();
  insert into public.profiles (user_id) values (uid) on conflict do nothing;
  update public.invitations set used_at = now(), used_by = uid where id = inv.id;
  return inv.org_id;
end
$$;

create or replace function public.admin_count(p_org uuid)
returns int
language sql stable security definer
set search_path = public, pg_temp
as $$
  select count(*)::int from public.memberships where org_id = p_org and role = 'admin' and status = 'active'
$$;

create or replace function public.set_member_role(p_org uuid, p_user uuid, p_role text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  current_role_ text;
begin
  perform public.require_caller();
  if not public.is_admin_of(p_org) then
    raise exception 'only an admin can change roles' using errcode = '42501';
  end if;
  select role into current_role_ from public.memberships
   where org_id = p_org and user_id = p_user and status = 'active';
  if not found then
    raise exception 'not a member' using errcode = 'P0002';
  end if;
  if current_role_ = 'admin' and p_role <> 'admin' and public.admin_count(p_org) <= 1 then
    raise exception 'an organisation must keep at least one admin' using errcode = '23514';
  end if;
  update public.memberships set role = p_role where org_id = p_org and user_id = p_user;
end
$$;

create or replace function public.remove_member(p_org uuid, p_user uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := public.require_caller();
  current_role_ text;
begin
  if p_user <> uid and not public.is_admin_of(p_org) then
    raise exception 'only an admin can remove someone else' using errcode = '42501';
  end if;
  select role into current_role_ from public.memberships
   where org_id = p_org and user_id = p_user and status = 'active';
  if not found then
    raise exception 'not a member' using errcode = 'P0002';
  end if;
  if current_role_ = 'admin' and public.admin_count(p_org) <= 1 then
    raise exception 'an organisation must keep at least one admin' using errcode = '23514';
  end if;
  update public.memberships set status = 'removed' where org_id = p_org and user_id = p_user;
end
$$;

-- The caller's display name is the one direct write a person makes.
create or replace function public.set_display_name(p_name text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := public.require_caller();
begin
  insert into public.profiles (user_id, display_name) values (uid, trim(p_name))
  on conflict (user_id) do update set display_name = excluded.display_name;
end
$$;

-- The caller's reach as one JSON answer for the app's top bar and organisation switcher:
--   { "signed_in": bool, "nza_team": bool, "orgs": [ { "id", "name", "role" }, … ] }
create or replace function public.my_access()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'signed_in', public.caller_id() is not null,
    'nza_team', public.is_nza_team(),
    'orgs', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'role', m.role) order by o.name)
        from public.memberships m join public.organisations o on o.id = m.org_id
       where m.user_id = public.caller_id() and m.status = 'active'), '[]'::jsonb))
$$;

-- ─── RLS and grants ──────────────────────────────────────────────────────────────────────────

alter table public.profiles       enable row level security;
alter table public.organisations  enable row level security;
alter table public.memberships    enable row level security;
alter table public.invitations    enable row level security;
alter table public.nza_team       enable row level security;
alter table public.org_links      enable row level security;

revoke all on all tables in schema public from anon, authenticated;

create policy profiles_own_read on public.profiles for select to authenticated
  using (user_id = (select public.caller_id()));
create policy profiles_colleague_read on public.profiles for select to authenticated
  using (exists (select 1 from public.memberships a join public.memberships b on a.org_id = b.org_id
                  where a.user_id = (select public.caller_id()) and a.status = 'active'
                    and b.user_id = profiles.user_id and b.status = 'active'));
grant select on public.profiles to authenticated;

create policy organisations_member_read on public.organisations for select to authenticated
  using (public.can_read_org(id));
grant select on public.organisations to authenticated;

create policy memberships_org_read on public.memberships for select to authenticated
  using (public.can_read_org(org_id));
grant select on public.memberships to authenticated;

create policy invitations_admin_read on public.invitations for select to authenticated
  using (public.is_admin_of(org_id));
grant select on public.invitations to authenticated;

create policy nza_team_own_read on public.nza_team for select to authenticated
  using (user_id = (select public.caller_id()));
grant select on public.nza_team to authenticated;

create policy org_links_admin_read on public.org_links for select to authenticated
  using (public.is_admin_of(org_id));
grant select on public.org_links to authenticated;

-- Functions: nothing for anon except token validation; the rest to authenticated.
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_anonymous_caller(), public.caller_id(), public.require_caller(),
  public.role_in(uuid), public.can_read_org(uuid), public.can_edit_org(uuid), public.is_admin_of(uuid),
  public.is_nza_team(), public.token_hash(text), public.admin_count(uuid),
  public.create_organisation(text), public.invite_member(uuid, text, text),
  public.accept_invitation_token(text), public.set_member_role(uuid, uuid, text),
  public.remove_member(uuid, uuid), public.set_display_name(text), public.my_access()
  to authenticated;
grant execute on function public.accept_invitation_token(text), public.token_hash(text),
  public.is_anonymous_caller(), public.caller_id() to anon;

-- ─── Record this migration ───────────────────────────────────────────────────────────────────
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key, statements text[], name text);
insert into supabase_migrations.schema_migrations (version, name)
values ('20261114190001', '0001_tenancy') on conflict do nothing;
