-- 0007_weather_upload.sql — Brief 105 Part 5: editors and admins may save weather files to their organisation.
-- Project: "NZA Sim (dev)", ref jbjxduathkklruvbmeho. Applies after 0006. Never NZA Decoded or NZA Decoded Test.
--
-- Linzie's decision, 15 Nov 2026 21:02 (decision card "Let editors save weather files to their organisation inside
-- NZA Sim?": "Yes, editors can save them"). This is the one documented exception to supabase/README.md's rule that
-- writes go through security-definer functions: Storage uploads are made by the client, so the rule is held by this
-- policy instead.
--
-- What it allows: an admin or editor of an organisation (can_edit_org) adds a new file directly in that
-- organisation's folder, `<org id>/<name>.epw`, name of letters, digits, dot, dash and underscore only, at most 5 MB
-- (the bucket's limit from 0006). No update and no delete policy: a file cannot be replaced or removed from the app,
-- so a run that names a file keeps meaning the same file. Viewers cannot upload.

create policy weather_insert_editors on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'weather'
    and array_length(storage.foldername(name), 1) = 1
    and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and storage.filename(name) ~ '^[A-Za-z0-9._-]{1,120}\.epw$'
    and public.can_edit_org(((storage.foldername(name))[1])::uuid)
  );

insert into supabase_migrations.schema_migrations (version, name)
values ('20261115000007', '0007_weather_upload') on conflict do nothing;
