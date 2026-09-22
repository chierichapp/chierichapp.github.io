-- Solo admin può scrivere chierichetti e app_config (gruppi/messe).
-- Lettura resta per tutti gli utenti app (is_app_user).

drop policy if exists "chierichetti_write" on public.chierichetti;
create policy "chierichetti_admin_write" on public.chierichetti
  for all to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

drop policy if exists "config_write" on public.app_config;
create policy "config_admin_write" on public.app_config
  for all to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());
