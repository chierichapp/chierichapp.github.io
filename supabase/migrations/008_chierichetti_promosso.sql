-- Stato «promosso / ora cerimoniere» per chierichetti diventati account di login.
alter table public.chierichetti
  add column if not exists promosso boolean not null default false;

-- Allinea chi è già collegato a un account cerimoniere.
update public.chierichetti chi
set promosso = true
where exists (
  select 1
  from public.cerimonieri cer
  where cer.chierichetto_uuid = chi.uuid
)
and chi.promosso is distinct from true;
