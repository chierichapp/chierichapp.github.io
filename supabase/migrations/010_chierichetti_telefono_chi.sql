-- Chi è il titolare di ciascun telefono genitori/tutori.
alter table public.chierichetti
  add column if not exists telefono_chi text not null default '';

alter table public.chierichetti
  add column if not exists telefono2_chi text not null default '';
