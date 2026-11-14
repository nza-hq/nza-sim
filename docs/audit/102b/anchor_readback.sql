-- Brief 102a Part 5: read the anchor round trip back (any role that can read the tables; the SQL editor is fine).
-- Every column ending in _ok must be true.
select v.id as version_id,
       encode(sha256(convert_to(v.canonical, 'UTF8')), 'hex') = v.model_hash as stored_text_hash_ok,
       encode(sha256(convert_to(replace(v.canonical, b.id::text, '00000000-0000-4000-8000-00000000b1d0'), 'UTF8')), 'hex')
         = '5f1b3b7a3577fc24de39d2cdfcce704b77c80adfe83cfc299a5e39fb0ead68f5' as same_document_as_javascript_ok,
       v.weather_hash = 'c65711022b0ea7e05ccfe03565f5d6b377fa6ea9157e3bc0066f0793fa478cf2' as weather_is_the_epw_bytes_ok,
       r.engine_version = 'instant-1+b4338c87cd2434fdedb4740c' as engine_version_ok,
       abs((r.summary->>'eui_kwh_m2')::numeric - 133.2) <= 0.05 as eui_ok,
       abs((select sum(value::numeric) from jsonb_each_text(r.summary->'annual_by_fuel')) - 561572) <= 1 as total_kwh_ok,
       r.summary->>'eui_kwh_m2' as eui,
       (select sum(value::numeric) from jsonb_each_text(r.summary->'annual_by_fuel')) as total_kwh,
       (select count(*) from public.runs r2 where r2.model_version_id = v.id) as runs_on_version
  from public.organisations o
  join public.projects p on p.org_id = o.id and p.name = 'Bridgewater anchor fixture'
  join public.buildings b on b.project_id = p.id and b.name = 'Bridgewater anchor fixture'
  join public.model_versions v on v.building_id = b.id and v.canonical is not null
  left join public.runs r on r.model_version_id = v.id and r.engine_version = 'instant-1+b4338c87cd2434fdedb4740c'
 where o.name = 'NZA';
