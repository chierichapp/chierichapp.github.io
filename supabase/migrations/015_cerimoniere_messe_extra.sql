-- Gli utenti app possono creare e aggiornare celebrazioni straordinarie.
-- Le altre chiavi di app_config (gruppi e strutture) restano admin-only.
drop policy if exists "config_messe_extra_write" on public.app_config;
create policy "config_messe_extra_write" on public.app_config
  for all to authenticated
  using (public.is_app_user() and key = 'messeExtra')
  with check (public.is_app_user() and key = 'messeExtra');
