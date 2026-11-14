-- 0004_qa_fixes.sql — Brief 102a: the fixes for the bugs the independent QA of Brief 102 proved
-- (docs/audit/102a/qa_report.md). Project: "NZA Sim (dev)", ref jbjxduathkklruvbmeho. Applies after 0003.
-- Never NZA Decoded or NZA Decoded Test.

-- ─── Part 2 (QA M1, and M2's two equality checks): the client's canonical text is the document ──────────────
-- JavaScript prints numbers below 1e-6 and from 1e21 in exponent form; Postgres numeric prints digits. So SQL's
-- canonical_json cannot reproduce the browser's bytes for float noise such as -2.7755575615628914e-17, and every
-- such save was refused. The fix stops re-serialising in SQL: the client sends the exact canonical text it hashed,
-- the function checks sha256 of that text, and stores both the text (so the hash stays checkable forever) and the
-- parsed jsonb (for queries). public.model_hash(jsonb) stays for reading old rows, but is no longer the check.

alter table public.model_versions add column canonical text;
comment on column public.model_versions.canonical is
  'Brief 102a: the exact canonical JSON text the client hashed. sha256(canonical) = model_hash for every row '
  'saved through create_model_version from 0004 on; null for rows saved before it (their hash equals '
  'public.model_hash(document)).';

drop function public.create_model_version(uuid, text, jsonb, text, text, text, uuid, text);

create or replace function public.create_model_version(
  p_building uuid, p_schema_version text, p_canonical text,
  p_model_hash text, p_library_hash text, p_weather_hash text,
  p_parent uuid default null, p_note text default null)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := public.require_caller();
  computed text;
  doc jsonb;
  new_id uuid;
begin
  if not public.can_edit_org(public.org_of_building(p_building)) then
    raise exception 'only an editor or admin can save a model version' using errcode = '42501';
  end if;
  if p_canonical is null then
    raise exception 'no document text' using errcode = '22004';
  end if;
  computed := encode(sha256(convert_to(p_canonical, 'UTF8')), 'hex');
  if computed <> p_model_hash then
    raise exception 'model_hash % does not match the document text (sha256 %)', p_model_hash, computed
      using errcode = '23514';
  end if;
  doc := p_canonical::jsonb;
  if jsonb_typeof(doc) <> 'object' then
    raise exception 'the document must be a JSON object' using errcode = '23514';
  end if;
  if (doc -> 'building' ->> 'id') is distinct from p_building::text then
    raise exception 'the document names building %, not %', doc -> 'building' ->> 'id', p_building
      using errcode = '23514';
  end if;
  if (doc ->> 'schema_version') is distinct from p_schema_version then
    raise exception 'the document is schema version %, not %', doc ->> 'schema_version', p_schema_version
      using errcode = '23514';
  end if;
  if doc -> 'weather_ref' ->> 'kind' = 'epw' and (doc -> 'weather_ref' ->> 'file_hash') is distinct from p_weather_hash then
    raise exception 'weather_hash % is not the document''s EPW hash %', p_weather_hash, doc -> 'weather_ref' ->> 'file_hash'
      using errcode = '23514';
  end if;
  if p_parent is not null and public.org_of_version(p_parent) is distinct from public.org_of_building(p_building) then
    raise exception 'parent version belongs to another organisation' using errcode = '42501';
  end if;
  insert into public.model_versions
    (building_id, parent_id, schema_version, document, canonical, model_hash, library_hash, weather_hash, note, created_by)
  values
    (p_building, p_parent, p_schema_version, doc, p_canonical, p_model_hash, p_library_hash, p_weather_hash, p_note, uid)
  returning id into new_id;
  return new_id;
end
$$;

revoke all on function public.create_model_version(uuid, text, text, text, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_model_version(uuid, text, text, text, text, text, uuid, text)
  to authenticated;
