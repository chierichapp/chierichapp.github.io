-- Cerimonieri: email opzionale (anagrafica senza login).
-- Più record possono avere email vuota; le email non vuote restano uniche.

alter table public.cerimonieri
  drop constraint if exists cerimonieri_email_key;

alter table public.cerimonieri
  alter column email drop not null;

alter table public.cerimonieri
  alter column email set default '';

update public.cerimonieri
set email = ''
where email is null;

create unique index if not exists cerimonieri_email_unique_nonempty
  on public.cerimonieri (lower(email))
  where length(trim(email)) > 0;

comment on column public.cerimonieri.email is
  'Email di login. Vuota = solo anagrafica, senza accesso all''app.';
