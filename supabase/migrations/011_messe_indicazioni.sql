-- Note del don per messa / celebrazione: leggibili e scrivibili da tutti gli utenti app.
insert into public.app_config (key, value)
values ('messeIndicazioni', '{}'::jsonb)
on conflict (key) do nothing;

drop policy if exists "config_indicazioni_write" on public.app_config;
create policy "config_indicazioni_write" on public.app_config
  for all to authenticated
  using (public.is_app_user() and key = 'messeIndicazioni')
  with check (public.is_app_user() and key = 'messeIndicazioni');
