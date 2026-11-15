-- 0006_weather_bucket.sql — Brief 105 Part 4: a private Storage bucket for an organisation's weather files (EPW).
-- Project: "NZA Sim (dev)", ref jbjxduathkklruvbmeho. Applies after 0005. Never NZA Decoded or NZA Decoded Test.
--
-- Why a private bucket: Climate.OneBuilding states no open licence for its EPWs ("All Rights Reserved"), so none is
-- committed to the repo (docs/audit/105/00_reconnaissance.md §3). An organisation keeps the files it uses in its own
-- folder, `<org id>/<file name>.epw`, readable only by that organisation's members.
--
-- Reads only. Writing a file into Storage is a direct write by the client, which supabase/README.md's rule ("writes
-- go through security-definer functions only") does not allow; the upload policy is left for a decision
-- (docs/audit/105/04_seam.md). Until then the panel reads a local EPW in the browser (never uploaded), and files can
-- be placed in an organisation's folder from the dashboard.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('weather', 'weather', false, 5242880, null)
on conflict (id) do nothing;

-- Members of the organisation named by the first folder of the path may read its files.
create policy weather_read_own_org on storage.objects
  for select to authenticated
  using (
    bucket_id = 'weather'
    and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.can_read_org(((storage.foldername(name))[1])::uuid)
  );

insert into supabase_migrations.schema_migrations (version, name)
values ('20261115000006', '0006_weather_bucket') on conflict do nothing;
