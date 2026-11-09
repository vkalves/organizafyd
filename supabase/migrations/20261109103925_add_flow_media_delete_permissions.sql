begin;

create policy owner_delete on public.ig_flow_library
  for delete to authenticated
  using ((select auth.uid()) = user_id);

grant delete on public.ig_flow_library to authenticated;

create policy ig_media_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'instagram-publisher'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

commit;
