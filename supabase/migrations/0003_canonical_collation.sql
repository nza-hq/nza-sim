-- 0003_canonical_collation.sql — Brief 102 Part 2 (same day as 0002): canonical_json sorts object keys in
-- byte order, as JavaScript's Array.prototype.sort does on UTF-16 code units, not in the database's default
-- collation (en_US.utf8 puts "a" before "B"; code-unit order puts "B" before "a"). Without this a document with
-- mixed-case or non-ASCII keys would hash differently in SQL and in the browser and every save would be refused.
-- Found while reading frontend/src/thermal/schema/canonical.ts (Part 1) against 0002; applied before any row
-- was stored, so nothing needs re-hashing.
--
-- Known remaining divergence, documented not fixed: JavaScript prints very large or very small numbers in
-- exponent form (1e21, 1.5e-7) and Postgres numeric prints digits. Model documents hold ordinary magnitudes;
-- Part 1's tests pin the anchor fixture, and create_model_version refuses loudly if the two ever disagree.

create or replace function public.canonical_json(j jsonb)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select case jsonb_typeof(j)
    when 'object' then '{' || coalesce((
        select string_agg(to_json(k)::text || ':' || public.canonical_json(v), ',' order by k collate "C")
          from jsonb_each(j) as e(k, v)), '') || '}'
    when 'array' then '[' || coalesce((
        select string_agg(public.canonical_json(v), ',' order by ord)
          from jsonb_array_elements(j) with ordinality as e(v, ord)), '') || ']'
    when 'number' then case when trim_scale((j::text)::numeric) = 0 then '0' else trim_scale((j::text)::numeric)::text end
    else j::text
  end
$$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261114190003', '0003_canonical_collation') on conflict do nothing;
