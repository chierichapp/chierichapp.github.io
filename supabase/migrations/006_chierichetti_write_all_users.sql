-- Chierichetti: ogni utente app (cerimoniere/Don) può scrivere.
-- app_config (gruppi/messe) resta admin-only (005).

drop policy if exists "chierichetti_admin_write" on public.chierichetti;
drop policy if exists "chierichetti_write" on public.chierichetti;

create policy "chierichetti_write" on public.chierichetti
  for all to authenticated
  using (public.is_app_user())
  with check (public.is_app_user());
